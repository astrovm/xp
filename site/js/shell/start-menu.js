"use strict";

// ============================================
// Start Menu
// ============================================

const createMenuGameItem = (gameId, gameStats) => {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "sm-game";

  const icon = createGameIconElement(gameId, "sm-game-icon");

  const title = document.createElement("span");
  title.className = "sm-game-title";
  title.textContent = formatGameTitle(gameId);

  item.append(icon, title);

  const stats = gameStats[gameId];
  if (stats) {
    const playCount = document.createElement("span");
    playCount.className = "play-count";
    playCount.textContent = `${stats.plays} ${stats.plays === 1 ? "play" : "plays"}`;
    item.appendChild(playCount);
  }

  item.addEventListener("click", () => {
    closeStartMenu();
    openGameWindow(gameId);
  });
  return item;
};

const getProgramGroups = () => {
  const groups = {};
  const addToGroup = (category, gameId) => {
    if (!groups[category]) groups[category] = [];
    groups[category].push(gameId);
  };

  Object.entries(getGameStats())
    .sort((left, right) => right[1].lastPlayed - left[1].lastPlayed)
    .slice(0, 8)
    .forEach(([gameId]) => {
      if (gamesList[gameId]) addToGroup("Recently Played", gameId);
    });

  getFavorites().forEach((gameId) => {
    if (gamesList[gameId]) addToGroup("Favorites", gameId);
  });

  Object.entries(gamesList).forEach(([gameId, game]) =>
    addToGroup(game.category || "Other", gameId),
  );

  const groupRank = (name) =>
    name === "Recently Played" ? 0 : name === "Favorites" ? 1 : 2;
  return Object.keys(groups)
    .sort(
      (left, right) =>
        groupRank(left) - groupRank(right) || left.localeCompare(right),
    )
    .map((category) => [
      category,
      groups[category]
        .slice()
        .sort((left, right) =>
          formatGameTitle(left).localeCompare(formatGameTitle(right)),
        ),
    ]);
};

// XP lists recent documents in a submenu; here they are recently played games.
const getRecentDocuments = () => {
  const { recentClearedAt } = getStartMenuOptions();
  const recentGames = Object.entries(getGameStats())
    .filter(
      ([gameId, stats]) =>
        gamesList[gameId] && stats.lastPlayed > recentClearedAt,
    )
    .sort(([, a], [, b]) => b.lastPlayed - a.lastPlayed)
    .slice(0, 15)
    .map(([gameId]) => ({ gameId }));
  return recentGames.length ? recentGames : [{ empty: true }];
};

const openControlPanel = () => openSystemWindow("__control-panel");

// ShellAbout: programs such as Task Manager pass their name and icon.
const openAboutWindows = ({
  application = "Windows",
  icon = "",
  otherStuff = "",
} = {}) => {
  const dialog = XPDialogs.createDialog({ title: `About ${application}` });
  dialog.el.classList.add("about-windows-dialog");
  dialog.body.innerHTML = `
    <img class="about-windows-banner" src="assets/xp/AboutWindows.png" alt="Microsoft Windows XP Professional">
    ${icon && `<img class="about-windows-icon" src="${icon}" alt="">`}
    <div class="about-windows-copy">
      <p>Microsoft ® ${application}<br>Version 5.1 (Build 2600.xpsp.080413-2111 : Service Pack 3)<br>Copyright © 2007 Microsoft Corporation${otherStuff && `<br>${otherStuff}`}</p>
      <p>This product is licensed under the terms of the <a href="https://www.microsoft.com/useterms/" target="_blank" rel="noreferrer">End-User<br>License Agreement</a> to:</p>
      <p class="about-windows-user">astro</p>
      <hr>
      <p>Physical memory available to Windows:&nbsp;&nbsp; 523,696 KB</p>
    </div>
  `;
  XPDialogs.addButtonRow(dialog, [
    { id: "ok", label: "OK", isDefault: true, isCancel: true },
  ]);
};

const openShellProperties = (nodeId) => XPDialogs.properties(nodeId);

const openSearchDialog = () => openSystemWindow("__search");

// Task Manager's New Task opens the same dialog titled "Create New Task".
const openRunDialog = ({ title = "Run" } = {}) => {
  const dialog = XPDialogs.createDialog({ title });
  dialog.el.classList.add("run-dialog");
  const introRow = document.createElement("div");
  introRow.className = "run-dialog-intro";
  const icon = document.createElement("img");
  icon.src = "assets/xp/icons/Run.png";
  icon.alt = "";
  const intro = document.createElement("p");
  intro.textContent =
    "Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.";
  introRow.append(icon, intro);
  const prompt = document.createElement("label");
  const promptText = document.createElement("span");
  setAccessKeyText(promptText, "&Open:");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "shell-dialog-input";
  input.setAttribute("list", "run-command-history");
  input.id = "run-command";
  const history = document.createElement("datalist");
  history.id = "run-command-history";
  getRunHistory().forEach((entry) =>
    history.appendChild(new Option(entry, entry)),
  );
  prompt.append(promptText, input);
  const status = document.createElement("p");
  status.className = "shell-dialog-status";
  status.hidden = true;
  const run = () => {
    const resolved = resolveShellCommand(input.value);
    if (!resolved || resolved.run() === false) {
      // XP titles this error with the command that could not be found.
      status.textContent = `Windows cannot find '${input.value}'. Make sure you typed the name correctly, and then try again. To search for a file, click the Start button, and then click Search.`;
      XPDialogs.alert(status.textContent, input.value, "error");
      return;
    }
    rememberRunCommand(input.value);
    dialog.close();
  };
  const runButton = XPDialogs.createDialogButton(
    { id: "run", label: "&OK" },
    run,
  );
  const browseButton = XPDialogs.createDialogButton(
    { id: "browse", label: "&Browse..." },
    async () => {
      const node = await XPDialogs.openFile({ title: "Browse" });
      if (node) input.value = fs.getPath(node.id);
      input.focus();
    },
  );
  const cancelButton = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel" },
    () => dialog.close(),
  );
  const row = document.createElement("div");
  row.className = "dlg-buttons";
  row.append(runButton, cancelButton, browseButton);
  dialog.body.append(introRow, prompt, history, status, row);
  dialog.defaultButton = runButton;
  [
    [runButton, "&OK"],
    [cancelButton, "Cancel"],
    [browseButton, "&Browse..."],
  ].forEach(([button, label]) => {
    const { key } = XPDialogs.parseAccessKey(label);
    if (key && !dialog.accessKeys.has(key)) dialog.accessKeys.set(key, button);
  });
  dialog.accessKeys.set("o", { disabled: false, click: () => input.focus() });
  input.focus();
};

// Customize Start Menu options. Each one changes what the menu shows.
const START_MENU_OPTIONS_KEY = "startMenuOptions";
const START_MENU_ITEM_IDS = [
  "controlPanel",
  "computer",
  "documents",
  "music",
  "pictures",
];
const DEFAULT_START_MENU_OPTIONS = Object.freeze({
  largeIcons: true,
  programCount: 6,
  showInternet: true,
  hoverOpen: true,
  listRecent: true,
  run: true,
  search: true,
  items: Object.freeze(
    Object.fromEntries(START_MENU_ITEM_IDS.map((id) => [id, "link"])),
  ),
  programsClearedAt: 0,
  recentClearedAt: 0,
  classicRun: true,
  classicSmallIcons: false,
  classicExpand: Object.freeze({
    controlPanel: false,
    documents: false,
    pictures: false,
  }),
});
const getStartMenuOptions = () => {
  const stored = readJsonStorage(
    START_MENU_OPTIONS_KEY,
    {},
    (value) => value && typeof value === "object" && !Array.isArray(value),
  );
  const pick = (key, valid) =>
    valid(stored[key]) ? stored[key] : DEFAULT_START_MENU_OPTIONS[key];
  const isBoolean = (value) => typeof value === "boolean";
  const isTime = (value) => Number.isFinite(value) && value >= 0;
  return {
    largeIcons: pick("largeIcons", isBoolean),
    programCount: pick(
      "programCount",
      (value) => Number.isInteger(value) && value >= 0 && value <= 30,
    ),
    showInternet: pick("showInternet", isBoolean),
    hoverOpen: pick("hoverOpen", isBoolean),
    listRecent: pick("listRecent", isBoolean),
    run: pick("run", isBoolean),
    search: pick("search", isBoolean),
    items: Object.fromEntries(
      START_MENU_ITEM_IDS.map((id) => [
        id,
        ["link", "menu", "none"].includes(stored.items?.[id])
          ? stored.items[id]
          : "link",
      ]),
    ),
    programsClearedAt: pick("programsClearedAt", isTime),
    recentClearedAt: pick("recentClearedAt", isTime),
    classicRun: pick("classicRun", isBoolean),
    classicSmallIcons: pick("classicSmallIcons", isBoolean),
    classicExpand: Object.fromEntries(
      ["controlPanel", "documents", "pictures"].map((id) => [
        id,
        stored.classicExpand?.[id] === true,
      ]),
    ),
  };
};
const saveStartMenuOptions = (changes) => {
  writeJsonStorage(START_MENU_OPTIONS_KEY, {
    ...getStartMenuOptions(),
    ...changes,
  });
  renderedPlacesStyle = null;
  renderedPinnedKey = null;
};

// "Display as a menu" lists a folder's contents, with subfolders as submenus.
const getFolderMenu = (folderId) => {
  const children = fs
    .getChildren(folderId)
    .slice()
    .sort(
      (left, right) =>
        (left.type === "folder" ? 0 : 1) - (right.type === "folder" ? 0 : 1) ||
        startMenuTitleCollator.compare(left.name, right.name),
    )
    .map((node) => ({
      text: node.name,
      ...(node.id === fs.DRIVE_F
        ? { icon: "RemovableMedia.png" }
        : node.id === fs.DRIVE_C || node.id === fs.DRIVE_D
          ? { icon: "LocalDisk.png" }
          : node.type === "folder"
            ? { icon: "NewFolder.png" }
            : { iconSrc: XP_ICON_PATHS[fileIconName(node.name)] }),
      ...(node.type === "folder"
        ? { children: () => getFolderMenu(node.id) }
        : { action: () => openDesktopItem(node.id) }),
    }));
  return children.length ? children : [{ empty: true }];
};

const getControlPanelMenu = () => [
  {
    label: "Date and Time",
    icon: "DateTimeRegional.png",
    action: openDateTimeProperties,
  },
  {
    label: "Display",
    icon: "Display.png",
    action: () => openSystemWindow("__display-properties"),
  },
  {
    label: "Taskbar and Start Menu",
    icon: "TaskbarAndStartMenu.png",
    action: () => openTaskbarProperties(),
  },
];

const openCustomizeStartMenu = () => {
  const options = getStartMenuOptions();
  const dialog = XPDialogs.createDialog({
    title: "Customize Start Menu",
    help: true,
  });
  dialog.el.classList.add(
    "taskbar-properties-dialog",
    "customize-start-menu-dialog",
  );
  const itemRows = [
    ["controlPanel", "Control Panel", "ControlPanel.png"],
    ["computer", "My Computer", "MyComputer.png"],
    ["documents", "My Documents", "MyDocuments.png"],
    ["music", "My Music", "MyMusic.png"],
    ["pictures", "My Pictures", "MyPictures.png"],
  ]
    .map(
      ([id, label, icon]) => `
        <div class="customize-start-item"><img src="${XP_ICON_PATHS[icon]}" alt=""><span>${label}</span></div>
        ${[
          ["link", "Display as a link"],
          ["menu", "Display as a menu"],
          ["none", "Don't display this item"],
        ]
          .map(
            ([value, text]) =>
              `<label class="customize-start-choice"><input type="radio" name="start-item-${id}" value="${value}" ${options.items[id] === value ? "checked" : ""}> ${text}</label>`,
          )
          .join("")}`,
    )
    .join("");
  dialog.body.innerHTML = `
    <div class="taskbar-properties-tabs" role="tablist">
      <button type="button" role="tab" data-customize-tab="general" aria-selected="true">General</button>
      <button type="button" role="tab" data-customize-tab="advanced" aria-selected="false">Advanced</button>
    </div>
    <div class="taskbar-properties-panel" data-customize-panel="general">
      <div class="taskbar-properties-group customize-icon-size-group"><span class="taskbar-properties-legend">Select an icon size for programs</span>
        <img class="customize-large-icon" src="${XP_ICON_PATHS["MyComputer.png"]}" alt="">
        <label class="customize-large-choice"><input type="radio" name="start-icon-size" value="large" ${options.largeIcons ? "checked" : ""}> Large icons</label>
        <img class="customize-small-icon" src="${XP_ICON_PATHS["MyComputer.png"]}" alt="">
        <label class="customize-small-choice"><input type="radio" name="start-icon-size" value="small" ${options.largeIcons ? "" : "checked"}> Small icons</label>
      </div>
      <div class="taskbar-properties-group customize-programs-group"><span class="taskbar-properties-legend">Programs</span>
        <p>The Start menu contains shortcuts to the programs you use most often.<br>Clearing the list of shortcuts does not delete the programs.</p>
        <label class="customize-program-count">Number of programs on Start menu: <input type="number" min="0" max="30" value="${options.programCount}"></label>
        <button type="button" class="xp-btn customize-clear-programs">Clear List</button>
      </div>
      <div class="taskbar-properties-group customize-show-group"><span class="taskbar-properties-legend">Show on Start menu</span>
        <label class="customize-internet"><input type="checkbox" ${options.showInternet ? "checked" : ""}> Internet:</label>
        <select class="customize-internet-program" aria-label="Internet program"><option>Internet Games</option></select>
      </div>
    </div>
    <div class="taskbar-properties-panel" data-customize-panel="advanced" hidden>
      <div class="taskbar-properties-group customize-settings-group"><span class="taskbar-properties-legend">Start menu settings</span>
        <label><input type="checkbox" class="customize-hover-open" ${options.hoverOpen ? "checked" : ""}> Open submenus when I pause on them with my mouse</label>
      </div>
      <span class="customize-items-label">Start menu items:</span>
      <div class="customize-start-items" role="group" aria-label="Start menu items">
        ${itemRows}
        <label class="customize-start-check"><input type="checkbox" class="customize-run" ${options.run ? "checked" : ""}> Run command</label>
        <label class="customize-start-check"><input type="checkbox" class="customize-search" ${options.search ? "checked" : ""}> Search</label>
      </div>
      <div class="taskbar-properties-group customize-recent-group"><span class="taskbar-properties-legend">Recent documents</span>
        <p>Select this option to provide quick access to the documents you<br>opened most recently.  Clearing this list does not delete the documents.</p>
        <label class="customize-list-recent"><input type="checkbox" ${options.listRecent ? "checked" : ""}> List my most recently opened documents</label>
        <button type="button" class="xp-btn customize-clear-recent">Clear List</button>
      </div>
    </div>
    <div class="dlg-buttons taskbar-properties-buttons"></div>
  `;
  const tabs = [...dialog.body.querySelectorAll("[data-customize-tab]")];
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((entry) =>
        entry.setAttribute("aria-selected", String(entry === tab)),
      );
      dialog.body
        .querySelectorAll("[data-customize-panel]")
        .forEach((panel) => {
          panel.hidden =
            panel.dataset.customizePanel !== tab.dataset.customizeTab;
        });
    }),
  );
  const query = (selector) => dialog.body.querySelector(selector);
  // Clear List takes effect at once, like XP.
  const clearButton = (selector, key) => {
    const button = query(selector);
    button.addEventListener("click", () => {
      saveStartMenuOptions({ [key]: Date.now() });
      button.disabled = true;
    });
  };
  clearButton(".customize-clear-programs", "programsClearedAt");
  clearButton(".customize-clear-recent", "recentClearedAt");
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      const count = Number.parseInt(
        query(".customize-program-count input").value,
        10,
      );
      saveStartMenuOptions({
        largeIcons: query('[name="start-icon-size"]:checked').value === "large",
        programCount: Number.isInteger(count)
          ? Math.min(30, Math.max(0, count))
          : DEFAULT_START_MENU_OPTIONS.programCount,
        showInternet: query(".customize-internet input").checked,
        hoverOpen: query(".customize-hover-open").checked,
        listRecent: query(".customize-list-recent input").checked,
        run: query(".customize-run").checked,
        search: query(".customize-search").checked,
        items: Object.fromEntries(
          START_MENU_ITEM_IDS.map((id) => [
            id,
            query(`[name="start-item-${id}"]:checked`).value,
          ]),
        ),
      });
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  dialog.defaultButton = ok;
  query(".taskbar-properties-buttons").append(ok, cancel);
  ok.focus();
};

const openCustomizeClassicStartMenu = () => {
  const options = getStartMenuOptions();
  const dialog = XPDialogs.createDialog({
    title: "Customize Classic Start Menu",
    help: true,
  });
  dialog.el.classList.add(
    "taskbar-properties-dialog",
    "customize-classic-start-menu-dialog",
  );
  const choices = [
    ["classic-run", "Display Run", options.classicRun],
    [
      "expand-controlPanel",
      "Expand Control Panel",
      options.classicExpand.controlPanel,
    ],
    [
      "expand-documents",
      "Expand My Documents",
      options.classicExpand.documents,
    ],
    ["expand-pictures", "Expand My Pictures", options.classicExpand.pictures],
    [
      "classic-small-icons",
      "Show Small Icons in Start menu",
      options.classicSmallIcons,
    ],
  ]
    .map(
      ([id, label, checked]) =>
        `<label class="customize-start-check"><input type="checkbox" data-classic-option="${id}" ${checked ? "checked" : ""}> ${label}</label>`,
    )
    .join("");
  dialog.body.innerHTML = `
    <div class="taskbar-properties-group customize-classic-group"><span class="taskbar-properties-legend">Start menu</span>
      <img class="customize-classic-clear-icon" src="${XP_ICON_PATHS["RecyclerFull.png"]}" alt="">
      <p>To remove records of recently<br>accessed documents, programs,<br>and Web sites, click Clear.</p>
      <button type="button" class="xp-btn customize-classic-clear">Clear</button>
    </div>
    <span class="customize-items-label customize-classic-options-label">Advanced Start menu options:</span>
    <div class="customize-start-items customize-classic-options" role="group" aria-label="Advanced Start menu options">${choices}</div>
    <div class="dlg-buttons taskbar-properties-buttons"></div>
  `;
  const query = (selector) => dialog.body.querySelector(selector);
  const clear = query(".customize-classic-clear");
  clear.addEventListener("click", () => {
    const now = Date.now();
    saveStartMenuOptions({ programsClearedAt: now, recentClearedAt: now });
    clear.disabled = true;
  });
  const checked = (id) => query(`[data-classic-option="${id}"]`).checked;
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      saveStartMenuOptions({
        classicRun: checked("classic-run"),
        classicSmallIcons: checked("classic-small-icons"),
        classicExpand: {
          controlPanel: checked("expand-controlPanel"),
          documents: checked("expand-documents"),
          pictures: checked("expand-pictures"),
        },
      });
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  dialog.defaultButton = ok;
  query(".taskbar-properties-buttons").append(ok, cancel);
  ok.focus();
};

const startDestinationActions = {
  documents: () => openSystemWindow("__my-documents"),
  pictures: () => openSystemWindow("__my-pictures"),
  music: () => openSystemWindow("__my-music"),
  computer: () => openSystemWindow("__my-computer"),
  controlPanel: openControlPanel,
  search: openSearchDialog,
  run: openRunDialog,
};

const buildPlaces = () => {
  const container = document.getElementById("start-menu-places");
  const style = getStartMenuStyle();
  const options = getStartMenuOptions();
  const renderKey = JSON.stringify([style, options]);
  if (renderedPlacesStyle === renderKey) return;
  renderedPlacesStyle = renderKey;
  container.replaceChildren();

  const createPlace = ({
    id,
    label,
    icon,
    title = label,
    action,
    children,
    primary = false,
  }) => {
    const { key } = XPDialogs.parseAccessKey(label);
    const item = document.createElement("button");
    item.className = primary ? "sm-place sm-place-primary" : "sm-place";
    item.type = "button";
    if (id) item.dataset.startAction = id;
    item.dataset.accessKey = key;
    item.title = XPDialogs.parseAccessKey(title).text;

    const glyph = document.createElement("span");
    glyph.className = "sm-place-icon";
    const image = document.createElement("img");
    image.src = XP_ICON_PATHS[icon];
    image.alt = "";
    glyph.appendChild(image);

    const text = document.createElement("span");
    setAccessKeyText(text, label);
    item.append(glyph, text);
    if (children) {
      item.classList.add("classic-start-folder");
      item.setAttribute("aria-haspopup", "menu");
      const arrow = document.createElement("span");
      arrow.className = "start-program-arrow";
      arrow.textContent = "▶";
      item.appendChild(arrow);
      const open = (focusFirst = false) => {
        openProgramSubmenu(
          typeof children === "function" ? children() : children,
          item,
          0,
        );
        item.classList.add("submenu-open");
        if (focusFirst)
          document
            .querySelector("#start-menu-flyouts .start-program-flyout button")
            ?.focus();
      };
      item.addEventListener("pointerenter", () => {
        clearTimeout(startFlyoutTimer);
        if (getStartMenuOptions().hoverOpen)
          startFlyoutTimer = setTimeout(open, 220);
      });
      // Without clearing here, a hover just before the click leaves its
      // 220ms timer pending; it later fires open() again on its own stale
      // closure over this item, which can reposition the flyout against
      // whatever the anchor's rect happens to be by then.
      item.addEventListener("click", () => {
        clearTimeout(startFlyoutTimer);
        open(true);
      });
      item.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "Enter"].includes(event.key)) return;
        event.preventDefault();
        clearTimeout(startFlyoutTimer);
        open(true);
      });
    } else {
      item.addEventListener("click", () => {
        closeStartMenu();
        (action || startDestinationActions[id])();
      });
    }
    return item;
  };

  container.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = container.querySelector(
      `[data-access-key="${event.key.toLowerCase()}"]`,
    );
    if (!item) return;
    event.preventDefault();
    item.click();
  });

  document.getElementById("start-menu").classList.remove("classic-small-icons");
  if (style === "classic") {
    // Expand options turn these entries into menus of their contents.
    const expandable = (id, definition, children) =>
      options.classicExpand[id]
        ? { label: definition.label, icon: definition.icon, children }
        : definition;
    const recent = getRecentDocuments().filter(
      (definition) => !definition.empty,
    );
    const documents = [
      expandable(
        "documents",
        {
          label: "My &Documents",
          icon: "MyDocuments.png",
          action: startDestinationActions.documents,
        },
        () => getFolderMenu(fs.MY_DOCUMENTS),
      ),
      expandable(
        "pictures",
        {
          label: "My &Pictures",
          icon: "MyPictures.png",
          action: startDestinationActions.pictures,
        },
        () => getFolderMenu(fs.MY_PICTURES),
      ),
      {
        label: "My &Music",
        icon: "MyMusic.png",
        action: startDestinationActions.music,
      },
      ...(recent.length ? [{ separator: true }, ...recent] : []),
    ];
    const settings = [
      expandable(
        "controlPanel",
        {
          label: "&Control Panel",
          icon: "ControlPanel.png",
          action: startDestinationActions.controlPanel,
        },
        getControlPanelMenu,
      ),
      {
        label: "Taskbar and Start &Menu",
        icon: "TaskbarAndStartMenu.png",
        action: openTaskbarProperties,
      },
    ];
    document
      .getElementById("start-menu")
      .classList.toggle("classic-small-icons", options.classicSmallIcons);
    [
      { label: "&Documents", icon: "RecentDocuments.png", children: documents },
      { label: "&Settings", icon: "ControlPanel.png", children: settings },
      {
        label: "Sear&ch",
        icon: "Search.png",
        children: [
          {
            id: "search-files",
            label: "For &Files or Folders...",
            icon: "Search.png",
            action: startDestinationActions.search,
          },
        ],
      },
      options.classicRun
        ? { id: "run", label: "&Run...", icon: "Run.png" }
        : null,
    ]
      .filter(Boolean)
      .forEach((definition) => container.appendChild(createPlace(definition)));
    return;
  }

  const addSeparator = () => {
    const separator = document.createElement("div");
    separator.className = "sm-place-separator";
    container.appendChild(separator);
  };
  const folderIds = {
    documents: fs.MY_DOCUMENTS,
    pictures: fs.MY_PICTURES,
    music: fs.MY_MUSIC,
    computer: fs.MY_COMPUTER,
  };
  const place = (id, label, icon, extra = {}) => {
    const display = options.items[id];
    if (display === "none") return null;
    if (display === "menu")
      extra.children =
        id === "controlPanel"
          ? getControlPanelMenu
          : () => getFolderMenu(folderIds[id]);
    return createPlace({ id, label, icon, ...extra });
  };
  const appendGroup = (items) => {
    const shown = items.filter(Boolean);
    if (!shown.length) return;
    if (container.children.length) addSeparator();
    shown.forEach((item) => container.appendChild(item));
  };
  appendGroup([
    place("documents", "My &Documents", "MyDocuments.png", { primary: true }),
    options.listRecent
      ? createPlace({
          id: "recent",
          label: "My &Recent Documents",
          icon: "RecentDocuments.png",
          children: getRecentDocuments,
          primary: true,
        })
      : null,
    place("pictures", "My &Pictures", "MyPictures.png", { primary: true }),
    place("music", "My &Music", "MyMusic.png", { primary: true }),
    place("computer", "My &Computer", "MyComputer.png", { primary: true }),
  ]);
  appendGroup([place("controlPanel", "&Control Panel", "ControlPanel.png")]);
  appendGroup([
    options.search
      ? createPlace({ id: "search", label: "&Search", icon: "Search.png" })
      : null,
    options.run
      ? createPlace({ id: "run", label: "&Run...", icon: "Run.png" })
      : null,
  ]);
};

// The pinned list only changes when favorites, play history or the menu style
// change, so opening the Start menu reuses it otherwise.
let renderedPinnedKey = null;
const startMenuTitleCollator = new Intl.Collator();
const buildPinnedPrograms = () => {
  const container = document.getElementById("start-menu-pinned");
  const style = getStartMenuStyle();
  const gameStats = getGameStats();
  const options = getStartMenuOptions();
  const recentGames = Object.entries(gameStats)
    .filter(
      ([gameId, stats]) =>
        gamesList[gameId] && stats.lastPlayed > options.programsClearedAt,
    )
    .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
    .map(([gameId]) => gameId);
  const pinned =
    style === "classic"
      ? []
      : [
          ...getFavorites().filter((gameId) => gamesList[gameId]),
          ...recentGames,
          ...Object.keys(gamesList).sort((a, b) =>
            startMenuTitleCollator.compare(
              formatGameTitle(a),
              formatGameTitle(b),
            ),
          ),
        ]
          .filter((gameId, index, all) => all.indexOf(gameId) === index)
          .slice(0, options.programCount);
  const pinnedKey = JSON.stringify([
    style,
    options.showInternet,
    options.largeIcons,
    pinned.map((gameId) => [
      gameId,
      formatGameTitle(gameId),
      gamesList[gameId]?.icon,
      gameStats[gameId]?.plays,
    ]),
  ]);
  if (pinnedKey === renderedPinnedKey && container.isConnected) return;
  renderedPinnedKey = pinnedKey;
  // A program with the keys keeps them, else All Programs takes them.
  const giveKeysBack = holdKeys(
    container,
    (keys) => `[data-pinned-game="${CSS.escape(keys.dataset.pinnedGame)}"]`,
  );
  container.innerHTML = "";
  container.classList.toggle("sm-small-icons", !options.largeIcons);

  const allProgramsLabel = document.querySelector(
    "#all-programs-button > .all-programs-label",
  );
  const allProgramsButton = document.getElementById("all-programs-button");
  allProgramsButton.querySelector(".all-programs-icon")?.remove();
  if (getStartMenuStyle() === "classic") {
    allProgramsLabel.textContent = "Programs";
    const programsIcon = document.createElement("span");
    programsIcon.className = "all-programs-icon";
    const programsImage = document.createElement("img");
    programsImage.src = XP_ICON_PATHS["ProgramFolder.png"];
    programsImage.alt = "";
    programsIcon.appendChild(programsImage);
    allProgramsButton.prepend(programsIcon);
    return giveKeysBack(allProgramsButton);
  }
  allProgramsLabel.textContent = "All Programs";

  const internetGames = document.createElement("button");
  internetGames.type = "button";
  internetGames.className = "sm-game";
  const internetIcon = createGameIconElement(
    "__internet-games",
    "sm-game-icon",
  );
  internetGames.classList.add("sm-pinned");
  internetGames.dataset.pinnedGame = "__internet-games";
  const internetText = document.createElement("span");
  internetText.className = "sm-pinned-text";
  const internetTitle = document.createElement("span");
  internetTitle.className = "sm-game-title";
  internetTitle.textContent = "Internet Games";
  const internetSource = document.createElement("span");
  internetSource.className = "sm-pinned-subtitle";
  internetSource.textContent = "Flashpoint Archive";
  internetText.append(internetTitle, internetSource);
  internetGames.append(internetIcon, internetText);
  internetGames.addEventListener("click", () => {
    closeStartMenu();
    openSystemWindow("__internet-games");
  });
  if (options.showInternet) {
    container.appendChild(internetGames);
    const pinnedSeparator = document.createElement("div");
    pinnedSeparator.className = "sm-pinned-separator";
    container.appendChild(pinnedSeparator);
  }

  pinned.forEach((gameId) => {
    const item = createMenuGameItem(gameId, gameStats);
    item.dataset.pinnedGame = gameId;
    container.appendChild(item);
  });
  giveKeysBack(allProgramsButton);
};

let startFlyoutTimer = null;
const closeAllPrograms = () => {
  clearTimeout(startFlyoutTimer);
  const host = document.getElementById("start-menu-flyouts");
  giveKeysBackFrom(host);
  host.replaceChildren();
  host.hidden = true;
  document.getElementById("all-programs-button").classList.remove("active");
  document
    .querySelectorAll(".sm-place.submenu-open")
    .forEach((item) => item.classList.remove("submenu-open"));
};

const positionStartFlyout = (panel, anchor) => {
  const rect = anchor.getBoundingClientRect();
  const taskbarTop = document
    .getElementById("taskbar")
    .getBoundingClientRect().top;
  panel.style.visibility = "hidden";
  panel.style.left = "0px";
  panel.style.top = "0px";
  panel.style.maxHeight = `${Math.max(80, taskbarTop - 4)}px`;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const right = rect.right + width <= getViewportWidth() - 2;
  panel.style.left = `${Math.max(2, Math.min(right ? rect.right : rect.left - width, getViewportWidth() - width - 2))}px`;
  // All Programs grows upward from its button, like XP; submenus open at
  // their item and only move up when they would cross the taskbar.
  const preferredTop =
    anchor.id === "all-programs-button" && getStartMenuStyle() !== "classic"
      ? rect.bottom - height
      : rect.top;
  panel.style.top = `${Math.max(2, Math.min(preferredTop, taskbarTop - height - 2))}px`;
  panel.style.visibility = "";
};

const wireStartFlyoutKeyboard = (panel, parentButton) => {
  panel.addEventListener("keydown", (event) => {
    const items = [...panel.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeAllPrograms();
      parentButton.focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items.at(-1)
            : items[
                (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
              ];
      next?.focus();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      parentButton.focus();
      return;
    }
    const item = items.find(
      (entry) => entry.dataset.accessKey === event.key.toLowerCase(),
    );
    if (item) {
      event.preventDefault();
      item.click();
    }
  });
};

const xpProgramMenuItem = (programId, id = programId.slice(2)) => {
  const program = window.XPApplicationRegistry.get(programId);
  return {
    id,
    label: program.title,
    icon: program.icon,
    action: () => openXPProgram(programId),
  };
};

const getAllProgramsTree = () => {
  const programFolder = "ProgramFolder.png";
  const gameGroups = getProgramGroups().map(([category, games]) => ({
    label: category,
    icon: programFolder,
    children: games.map((gameId) => ({ gameId })),
  }));
  return [
    {
      id: "accessories",
      label: "Accessories",
      icon: programFolder,
      children: [
        {
          id: "entertainment",
          label: "Entertainment",
          icon: programFolder,
          children: [xpProgramMenuItem("__volume-control")],
        },
        xpProgramMenuItem("__calculator"),
        xpProgramMenuItem("__command-prompt"),
        {
          id: "notepad",
          label: "Notepad",
          icon: "Notepad.png",
          action: openNotepad,
        },
        xpProgramMenuItem("__paint"),
        {
          id: "windows-explorer",
          label: "Windows Explorer",
          icon: "WindowsExplorer.png",
          action: () => openSystemWindow("__my-documents"),
        },
      ],
    },
    {
      id: "games",
      label: "Games",
      icon: programFolder,
      children: [
        xpProgramMenuItem("__freecell"),
        xpProgramMenuItem("__hearts"),
        xpProgramMenuItem("__minesweeper"),
        xpProgramMenuItem("__pinball"),
        xpProgramMenuItem("__solitaire"),
        xpProgramMenuItem("__spider-solitaire"),
        { separator: true },
        ...gameGroups,
      ],
    },
    { separator: true },
    {
      id: "astro-settings",
      label: "Astro XP Settings",
      icon: "ControlPanel.png",
      action: openProjectSettings,
    },
    {
      id: "internet-games",
      label: "Internet Games",
      icon: "AddRemovePrograms.png",
      action: () => openSystemWindow("__internet-games"),
    },
  ];
};

const createProgramMenuItem = (definition, depth, gameStats) => {
  if (definition.empty) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "start-program-item start-program-empty";
    item.setAttribute("role", "menuitem");
    item.disabled = true;
    item.textContent = "(Empty)";
    return item;
  }
  if (definition.gameId) {
    const item = createMenuGameItem(definition.gameId, gameStats);
    item.setAttribute("role", "menuitem");
    return item;
  }
  const item = document.createElement("button");
  item.type = "button";
  item.className = definition.children
    ? "start-program-item start-program-folder"
    : "start-program-item";
  item.setAttribute("role", "menuitem");
  if (definition.id) item.dataset.programId = definition.id;
  const icon = document.createElement("span");
  icon.className = "start-program-icon";
  const image = document.createElement("img");
  image.src = definition.iconSrc || XP_ICON_PATHS[definition.icon];
  image.alt = "";
  icon.appendChild(image);
  const label = document.createElement("span");
  // File names are shown as-is; built-in labels carry access keys.
  if (definition.text) label.textContent = definition.text;
  else item.dataset.accessKey = setAccessKeyText(label, definition.label).key;
  item.append(icon, label);
  if (definition.children) {
    item.setAttribute("aria-haspopup", "menu");
    const arrow = document.createElement("span");
    arrow.className = "start-program-arrow";
    arrow.textContent = "▶";
    item.appendChild(arrow);
    const open = (focusFirst = false) => {
      openProgramSubmenu(
        typeof definition.children === "function"
          ? definition.children()
          : definition.children,
        item,
        depth + 1,
      );
      if (focusFirst)
        document
          .querySelectorAll("#start-menu-flyouts .start-program-flyout")
          [depth + 1]?.querySelector("button")
          ?.focus();
    };
    item.addEventListener("pointerenter", () => {
      clearTimeout(startFlyoutTimer);
      if (getStartMenuOptions().hoverOpen)
        startFlyoutTimer = setTimeout(open, 220);
    });
    // Without clearing here, a hover just before the click leaves its
    // 220ms timer pending; it later fires open() again on its own stale
    // closure over this item, which can reposition the flyout against
    // whatever the anchor's rect happens to be by then.
    item.addEventListener("click", () => {
      clearTimeout(startFlyoutTimer);
      open(true);
    });
    item.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "Enter"].includes(event.key)) return;
      event.preventDefault();
      clearTimeout(startFlyoutTimer);
      open(true);
    });
  } else {
    item.addEventListener("click", () => {
      closeStartMenu();
      definition.action();
    });
  }
  return item;
};

const openProgramSubmenu = (definitions, anchor, depth) => {
  // A detached anchor (e.g. a stale hover-timer firing after the menu
  // already closed/rebuilt) has an all-zero getBoundingClientRect(), which
  // positionStartFlyout would otherwise clamp to the top-left corner.
  if (!anchor.isConnected) return;
  const host = document.getElementById("start-menu-flyouts");
  // Keys in a menu that closes go back to the item that opens the new one.
  const giveKeysBack = holdKeys(host);
  [...host.querySelectorAll(".start-program-flyout")]
    .slice(depth)
    .forEach((panel) => panel.remove());
  const panel = document.createElement("div");
  panel.className = "start-program-flyout";
  panel.setAttribute("role", "menu");
  panel.dataset.depth = String(depth);
  const gameStats = getGameStats();
  definitions.forEach((definition) => {
    if (definition.separator) {
      const separator = document.createElement("span");
      separator.className = "start-program-separator";
      separator.setAttribute("role", "separator");
      panel.appendChild(separator);
    } else {
      panel.appendChild(createProgramMenuItem(definition, depth, gameStats));
    }
  });
  host.appendChild(panel);
  host.hidden = false;
  positionStartFlyout(panel, anchor);
  wireStartFlyoutKeyboard(panel, anchor);
  giveKeysBack(anchor);
  panel.addEventListener("pointerenter", () => clearTimeout(startFlyoutTimer));
  panel.addEventListener("pointerleave", () => {
    startFlyoutTimer = setTimeout(closeAllPrograms, 420);
  });
};

const openAllPrograms = (focusFirst = false) => {
  clearTimeout(startFlyoutTimer);
  const host = document.getElementById("start-menu-flyouts");
  const button = document.getElementById("all-programs-button");
  // A program with the keys keeps them, else All Programs takes them.
  const giveKeysBack = holdKeys(
    host,
    (keys) => `[data-program-id="${CSS.escape(keys.dataset.programId || "")}"]`,
  );
  host.replaceChildren();
  host.hidden = false;
  button.classList.add("active");
  openProgramSubmenu(getAllProgramsTree(), button, 0);
  giveKeysBack(button);
  if (focusFirst) host.querySelector(".start-program-flyout button")?.focus();
};

const toggleAllPrograms = () => {
  const host = document.getElementById("start-menu-flyouts");
  if (host.hidden) openAllPrograms(true);
  else closeAllPrograms();
};

// XP hides access-key underlines until the keyboard is used in the menu.
let startMenuKeyboardInput = false;
const showStartMenuKeyboardCues = (visible) => {
  document
    .getElementById("start-menu")
    .classList.toggle("keyboard-cues", visible);
  document
    .getElementById("start-menu-flyouts")
    .classList.toggle("keyboard-cues", visible);
};
document.addEventListener(
  "keydown",
  () => {
    startMenuKeyboardInput = true;
    if (!document.getElementById("start-menu").hidden)
      showStartMenuKeyboardCues(true);
  },
  true,
);
document.addEventListener(
  "pointerdown",
  () => {
    startMenuKeyboardInput = false;
  },
  true,
);

const openStartMenu = () => {
  const classic = getStartMenuStyle() === "classic";
  showStartMenuKeyboardCues(startMenuKeyboardInput);
  buildPinnedPrograms();
  buildPlaces();
  closeAllPrograms();
  const user = document.querySelector(".start-menu-user");
  if (classic) {
    // XP's Classic banner sets the edition in regular weight.
    const edition = document.createElement("span");
    edition.className = "start-menu-edition";
    edition.textContent = "Professional";
    user.replaceChildren("Windows XP ", edition);
  } else {
    user.textContent = "astro";
  }
  document.getElementById("log-off-button").lastChild.textContent = classic
    ? " Log Off astro..."
    : " Log Off";
  document.getElementById("turn-off-button").lastChild.textContent = classic
    ? " Turn Off Computer..."
    : " Turn Off Computer";
  document.getElementById("start-menu").hidden = false;
  revealTaskbar();
  document.getElementById("taskbar").style.zIndex = "8000";
  const menu = document.getElementById("start-menu");
  const rect = document.getElementById("start-button").getBoundingClientRect();
  const edge = getTaskbarSettings().edge;
  menu.style.position = "fixed";
  menu.style.bottom = "auto";
  menu.style.left = `${Math.max(0, Math.min(edge === "left" ? document.getElementById("taskbar").getBoundingClientRect().right : edge === "right" ? rect.left - menu.offsetWidth : rect.left, getViewportWidth() - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(0, Math.min(edge === "bottom" ? rect.top - menu.offsetHeight : edge === "top" ? rect.bottom : rect.top, getViewportHeight() - menu.offsetHeight))}px`;

  document.getElementById("start-button").classList.add("active");
  document.getElementById("start-button").focus({ preventScroll: true });
};

const closeStartMenu = () => {
  closeAllPrograms();
  const startMenu = document.getElementById("start-menu");
  giveKeysBackFrom(startMenu);
  startMenu.hidden = true;
  document.getElementById("start-button").classList.remove("active");
};

const toggleStartMenu = () => {
  const startMenu = document.getElementById("start-menu");
  if (startMenu.hidden) {
    openStartMenu();
  } else {
    closeStartMenu();
  }
};

const setupSearch = () => {
  const button = document.getElementById("all-programs-button");
  button.addEventListener("click", toggleAllPrograms);
  button.addEventListener("pointerenter", () => {
    if (
      !document.getElementById("start-menu").hidden &&
      getStartMenuOptions().hoverOpen
    ) {
      clearTimeout(startFlyoutTimer);
      startFlyoutTimer = setTimeout(openAllPrograms, 220);
    }
  });
  button.addEventListener("keydown", (event) => {
    if (["ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      openAllPrograms(true);
    }
  });
};
