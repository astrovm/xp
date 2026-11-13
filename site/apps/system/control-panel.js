// Control Panel, compared with XP SP3 in the reference VM. It shows the
// categories and icons that open working dialogs, with XP's Explorer chrome,
// history, views, and infotips.

const CONTROL_PANEL_ICON = "assets/xp/icons/ControlPanel.png";

const CATEGORIES = {
  appearance: {
    title: "Appearance and Themes",
    icon: "assets/xp/icons/AppearanceAndThemes.png",
    tip: "Change the appearance of desktop items, apply a theme or screen saver to your computer, or customize the Start menu and taskbar.",
    tasks: [
      ["theme", "Change the computer's theme"],
      ["desktop", "Change the desktop background"],
      ["screen-saver", "Choose a screen saver"],
      ["resolution", "Change the screen resolution"],
    ],
    icons: ["display", "taskbar-properties"],
  },
  datetime: {
    title: "Date, Time, Language, and Regional Options",
    icon: "assets/xp/icons/DateTimeRegional.png",
    tip: "Change the date, time, and time zone for your computer, the language to use, and the way numbers, currencies, dates, and times are displayed.",
    tasks: [["date-time", "Change the date and time"]],
    icons: ["date-time"],
  },
};

// Classic View's icons, in XP's alphabetical order.
const ICONS = {
  "date-time": ["Date and Time", "assets/xp/icons/DateAndTime.png"],
  display: ["Display", "assets/xp/icons/Display.png"],
  "taskbar-properties": [
    "Taskbar and Start Menu",
    "assets/xp/icons/TaskbarAndStartMenu.png",
  ],
};

const MENU_LABELS = {
  file: "&File",
  edit: "&Edit",
  view: "&View",
  help: "&Help",
};

export const createControlPanel = (context) => {
  const {
    closeGameWindow,
    fs,
    openAboutWindows,
    openDateTimeProperties,
    openSearchDialog,
    openSystemWindow,
    openTaskbarProperties,
    openWindows,
    renderTaskButtons,
    resolveShellCommand,
    setAccessKeyText,
  } = context;

  const render = () => {
    const content = document.createElement("div");
    content.className = "control-panel-content";
    content.innerHTML = `
    <div class="explorer-chrome control-panel-chrome">
      <div class="explorer-menu-row">
        <div class="explorer-menu-bar" role="menubar">${Object.keys(MENU_LABELS)
          .map(
            (name) =>
              `<button type="button" data-control-panel-menu="${name}" role="menuitem" aria-haspopup="menu" aria-expanded="false"></button>`,
          )
          .join("")}</div>
        <div class="explorer-brand" aria-hidden="true"><img src="assets/xp/WindowsFlag.png" alt=""></div>
      </div>
      <div class="explorer-toolbar" data-mouse-keeps-focus>
        <button type="button" data-control-panel-action="back"><img src="assets/xp/explorer/toolbar-back.png" alt=""> Back <span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
        <button type="button" data-control-panel-action="forward" aria-label="Forward"><img src="assets/xp/explorer/toolbar-forward.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
        <button type="button" data-control-panel-action="up" aria-label="Up"><img src="assets/xp/explorer/toolbar-up.png" alt=""></button>
        <span class="explorer-toolbar-separator" aria-hidden="true"></span>
        <button type="button" data-control-panel-action="search"><img src="assets/xp/explorer/toolbar-search.png" alt=""> Search</button>
        <button type="button" data-control-panel-action="folders" aria-pressed="false"><img src="assets/xp/explorer/toolbar-folders.png" alt=""> Folders</button>
        <span class="explorer-toolbar-separator" aria-hidden="true"></span>
        <button type="button" data-control-panel-action="views" aria-label="Views"><img src="assets/xp/explorer/toolbar-views.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
      </div>
      <form class="explorer-address"><span>Address</span><span class="explorer-address-field"><img src="${CONTROL_PANEL_ICON}" alt=""><input type="text" aria-label="Address" value="Control Panel"></span><button type="submit" aria-label="Go"><img src="assets/xp/icons/Go.png" alt=""></button></form>
      <div class="game-menu explorer-menu" role="menu" hidden></div>
    </div>
    <div class="control-panel-body">
      <aside class="explorer-sidebar control-panel-sidebar"></aside>
      <main class="control-panel-main"></main>
    </div>`;
    return content;
  };

  const wire = (win) => {
    const content = win.el.querySelector(".control-panel-content");
    const sidebar = content.querySelector(".control-panel-sidebar");
    const main = content.querySelector(".control-panel-main");
    const address = content.querySelector(".explorer-address input");
    const menu = content.querySelector(".explorer-menu");
    const button = (action) =>
      content.querySelector(
        `.explorer-toolbar [data-control-panel-action="${action}"]`,
      );
    content.querySelectorAll("[data-control-panel-menu]").forEach((entry) => {
      setAccessKeyText(entry, MENU_LABELS[entry.dataset.controlPanelMenu]);
    });

    // Pages are "home" or a category; Back and Forward walk them like XP.
    const history = ["home"];
    let position = 0;
    let classic = false;
    let view = "icons";
    const selection = new Set();

    const iconButton = (action, className = "") => {
      const [label, icon] = ICONS[action];
      return `<button type="button" class="${className}" data-control-panel-action="${action}"><img src="${icon}" alt=""><span>${label}</span></button>`;
    };
    // The task pane's one group is XP's special Control Panel group.
    const section = (links) =>
      `<section class="control-panel-special"><h3><button type="button" class="explorer-section-toggle" aria-expanded="true"><img src="${CONTROL_PANEL_ICON}" alt=""><span>Control Panel</span><b aria-hidden="true"></b></button></h3><div class="explorer-section-body">${links}</div></section>`;

    const renderPage = () => {
      const page = history[position];
      const category = CATEGORIES[page];
      const title = category?.title || "Control Panel";
      win.title = title;
      win.el.querySelector(".title-text").textContent = title;
      address.value = title;
      renderTaskButtons();
      button("back").disabled = position === 0;
      button("forward").disabled = position === history.length - 1;
      button("views").disabled = Boolean(category) || !classic;
      content.classList.toggle(
        "control-panel-category-page",
        Boolean(category),
      );
      content.classList.toggle("classic-view", !category && classic);
      selection.clear();
      if (category) {
        sidebar.innerHTML = "";
        main.innerHTML = `
          <div class="control-panel-category-heading"><img src="${category.icon}" alt=""><strong>${category.title}</strong></div>
          <h1>Pick a task...</h1>
          <div class="control-panel-task-links">${category.tasks
            .map(
              ([action, label]) =>
                `<button type="button" data-control-panel-action="${action}"><img src="assets/xp/icons/Go.png" alt=""><span>${label}</span></button>`,
            )
            .join("")}</div>
          <h2>or pick a Control Panel icon</h2>
          <div class="control-panel-category-icons">${category.icons
            .map((action) => iconButton(action))
            .join("")}</div>`;
        return;
      }
      sidebar.innerHTML = section(
        `<button type="button" data-control-panel-action="classic"><img src="assets/xp/icons/ControlPanelSmall.png" alt=""><span>Switch to ${classic ? "Category" : "Classic"} View</span></button>`,
      );
      if (classic) {
        main.innerHTML = `<div class="control-panel-icons" data-view="${view}" role="listbox" tabindex="0">${Object.keys(
          ICONS,
        )
          .map((action) => iconButton(action, "control-panel-icon"))
          .join("")}</div>`;
        return;
      }
      main.innerHTML = `<h1>Pick a category</h1><div class="control-panel-categories">${Object.entries(
        CATEGORIES,
      )
        .map(
          ([id, { title: label, icon, tip }]) =>
            `<button type="button" data-control-panel-category="${id}" title="${tip}"><img src="${icon}" alt=""><span>${label}</span></button>`,
        )
        .join("")}</div>`;
    };
    const go = (page) => {
      history.splice(position + 1, history.length, page);
      position = history.length - 1;
      renderPage();
    };

    const select = (items) => {
      selection.clear();
      items.forEach((item) => selection.add(item.dataset.controlPanelAction));
      content
        .querySelectorAll(".control-panel-icon")
        .forEach((item) =>
          item.classList.toggle(
            "selected",
            selection.has(item.dataset.controlPanelAction),
          ),
        );
    };
    const openDisplayTab = (tab) => {
      openSystemWindow("__display-properties");
      openWindows
        .get("__display-properties")
        .el.querySelector(`#display-tab-${tab}`)
        .click();
    };
    const commands = {
      theme: () => openDisplayTab("themes"),
      display: () => openDisplayTab("themes"),
      desktop: () => openDisplayTab("desktop"),
      "screen-saver": () => openDisplayTab("saver"),
      resolution: () => openDisplayTab("settings"),
      "taskbar-properties": openTaskbarProperties,
      "date-time": openDateTimeProperties,
      back: () => {
        position -= 1;
        renderPage();
      },
      forward: () => {
        position += 1;
        renderPage();
      },
      // Up goes from a category to Control Panel, and from there to the
      // Desktop folder.
      up: () => {
        if (history[position] !== "home") go("home");
        else {
          closeGameWindow(win.gameId);
          fs.open(fs.DESKTOP);
        }
      },
      search: openSearchDialog,
      folders: () => {
        const pressed = content.classList.toggle("folders-visible");
        button("folders").setAttribute("aria-pressed", String(pressed));
      },
      classic: () => {
        classic = !classic;
        renderPage();
      },
      views: () => showMenu("views", button("views")),
      open: () => selection.forEach((action) => commands[action]()),
      close: () => closeGameWindow(win.gameId),
      "select-all": () =>
        select([...content.querySelectorAll(".control-panel-icon")]),
      "invert-selection": () =>
        select(
          [...content.querySelectorAll(".control-panel-icon")].filter(
            (item) => !selection.has(item.dataset.controlPanelAction),
          ),
        ),
      "view-icons": () => {
        view = "icons";
        renderPage();
      },
      "view-list": () => {
        view = "list";
        renderPage();
      },
      refresh: renderPage,
      about: () => openAboutWindows(),
    };

    // XP's Explorer menus, with what Control Panel can do.
    const menus = () => {
      const icons = !CATEGORIES[history[position]] && classic;
      const views = [
        ["Icons", "view-icons", !icons, view === "icons"],
        ["List", "view-list", !icons, view === "list"],
      ];
      return {
        file: [["Open", "open", !selection.size], "-", ["Close", "close"]],
        edit: [
          ["Select All", "select-all", !icons, false, "Ctrl+A"],
          ["Invert Selection", "invert-selection", !icons],
        ],
        view: [...views, "-", ["Refresh", "refresh"]],
        views,
        help: [["About Windows", "about"]],
      };
    };
    let menuAnchor = null;
    // The control that had the keys before the menu gets them back when the
    // menu closes, like XP. The window sends a press on its toolbar back to
    // its control before this listener runs.
    let menuReturnFocus = null;
    win.el.addEventListener("focusin", (event) => {
      if (
        event.target === document.activeElement &&
        !menu.contains(event.target) &&
        !event.target.closest("[data-control-panel-menu]")
      )
        menuReturnFocus = event.target;
    });
    const closeMenu = () => {
      const holdsKeys = menu.contains(document.activeElement);
      menu.hidden = true;
      menuAnchor?.setAttribute("aria-expanded", "false");
      menuAnchor = null;
      if (holdsKeys)
        (menuReturnFocus?.isConnected ? menuReturnFocus : win.el).focus({
          preventScroll: true,
        });
    };
    // A press outside the window closes the menu through the shell.
    menu.closeMenus = closeMenu;
    const showMenu = (name, anchor) => {
      menu.innerHTML = menus()
        [name].map((entry) =>
          entry === "-"
            ? '<div class="game-menu-separator" role="separator"></div>'
            : `<button type="button" class="game-menu-item${entry[3] ? " checked" : ""}" role="menuitem" data-control-panel-command="${entry[1]}"${entry[2] ? " disabled" : ""}>${entry[3] ? '<span class="menu-check explorer-menu-radio">•</span>' : ""}<span>${entry[0]}</span>${entry[4] ? `<span class="menu-shortcut">${entry[4]}</span>` : ""}</button>`,
        )
        .join("");
      menu.style.left = `${anchor.offsetLeft}px`;
      menu.style.top = `${anchor.offsetTop + anchor.offsetHeight}px`;
      menu.hidden = false;
      menuAnchor = anchor;
      anchor.setAttribute("aria-expanded", "true");
    };

    content.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-control-panel-menu]");
      if (menuButton) {
        const open = menuButton.getAttribute("aria-expanded") === "true";
        closeMenu();
        if (!open) showMenu(menuButton.dataset.controlPanelMenu, menuButton);
        return;
      }
      const command = event.target.closest("[data-control-panel-command]");
      if (command) {
        closeMenu();
        commands[command.dataset.controlPanelCommand]();
        return;
      }
      closeMenu();
      const toggle = event.target.closest(".explorer-section-toggle");
      if (toggle) {
        const collapsed = toggle
          .closest("section")
          .classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        return;
      }
      const category = event.target.closest("[data-control-panel-category]");
      if (category) {
        go(category.dataset.controlPanelCategory);
        return;
      }
      // Classic View selects with a click and opens with a double-click.
      const icon = event.target.closest(".control-panel-icon");
      if (icon) {
        select([icon]);
        return;
      }
      const action = event.target.closest("[data-control-panel-action]");
      if (action && !action.disabled)
        commands[action.dataset.controlPanelAction]();
    });
    content.addEventListener("dblclick", (event) => {
      const icon = event.target.closest(".control-panel-icon");
      if (icon) commands[icon.dataset.controlPanelAction]();
    });
    // Enter opens the focused icon.
    content.addEventListener("keydown", (event) => {
      const icon = event.target.closest(".control-panel-icon");
      if (icon && event.key === "Enter") {
        event.preventDefault();
        commands[icon.dataset.controlPanelAction]();
      }
    });
    // Go opens what the address names, like Run; anything else puts the
    // current page back, as Explorer windows do.
    content
      .querySelector(".explorer-address")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const target = resolveShellCommand(address.value);
        address.value = win.title;
        target?.run();
      });

    renderPage();
  };

  return { render, wire };
};
