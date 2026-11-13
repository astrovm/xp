import { createControlPanel } from "./control-panel.js";

export const createSystemRuntime = (context) => {
  const {
    XPDialogs,
    closeGameWindow,
    confirmRecycleDelete,
    confirmPermanentDelete,
    explorerBack,
    explorerForward,
    fileOps,
    fs,
    navigateExplorer,
    openAboutWindows,

    openSearchDialog,
    openShellProperties,
    pasteIntoFolder,
    renderExplorerItems,
    renderExplorerTree,
    selectedExplorerNodes,
    renderExplorerSelection,
    setAccessKeyText,
    startExplorerRename,
    wireProjectSettings,
  } = context;

  const controlPanel = createControlPanel(context);

  const createSystemContentRoot = () => {
    const content = document.createElement("div");
    content.className = "explorer-content";
    return content;
  };

  const XP_SYSTEM_RENDERERS = Object.freeze({
    "__control-panel": () => controlPanel.render(),
    "__astro-settings": (win) => {
      const content = createSystemContentRoot();

      content.className = "project-settings-content";
      return content;
    },
    "__display-properties": (win) => {
      const content = createSystemContentRoot();
      const wallpapers = [
        ["none", "(None)"],
        ["ascent", "Ascent"],
        ["autumn", "Autumn"],
        ["azul", "Azul"],
        ["bliss", "Bliss"],
        ["blue-lace", "Blue Lace 16"],
        ["coffee", "Coffee Bean"],
        ["crystal", "Crystal"],
        ["follow", "Follow"],
        ["friend", "Friend"],
        ["greenstone", "Greenstone"],
        ["home", "Home"],
        ["moon-flower", "Moon flower"],
        ["peace", "Peace"],
        ["power", "Power"],
        ["prairie-wind", "Prairie Wind"],
        ["purple-flower", "Purple flower"],
        ["radiance", "Radiance"],
        ["red-moon-desert", "Red moon desert"],
        ["ripple", "Ripple"],
        ["stonehenge", "Stonehenge"],
        ["tulips", "Tulips"],
        ["vortec-space", "Vortec space"],
        ["wind", "Wind"],
        ["windows-xp", "Windows XP"],
        ["zapotec", "Zapotec"],
      ];
      // Sample windows drawn with the pending color scheme's Luna bitmaps.
      const sampleWindow = (title, className, buttons, body = "") =>
        `<div class="scheme-window ${className}"><div class="scheme-caption"><span>${title}</span>${buttons
          .map((button) => `<i class="tb-btn ${button}-btn"></i>`)
          .join("")}</div>${body}</div>`;
      const sampleText =
        '<div class="scheme-client"><span>Window Text</span><div class="scheme-scroll"><div></div></div></div>';

      content.className = "display-properties-content";
      content.innerHTML = `
            <div class="display-tabs" role="tablist" aria-label="Display Properties">
                <button type="button" role="tab" id="display-tab-themes" aria-controls="display-panel-themes" aria-selected="true">Themes</button>
                <button type="button" role="tab" id="display-tab-desktop" aria-controls="display-panel-desktop" aria-selected="false" tabindex="-1">Desktop</button>
                <button type="button" role="tab" id="display-tab-saver" aria-controls="display-panel-saver" aria-selected="false" tabindex="-1">Screen Saver</button>
                <button type="button" role="tab" id="display-tab-appearance" aria-controls="display-panel-appearance" aria-selected="false" tabindex="-1">Appearance</button>
                <button type="button" role="tab" id="display-tab-settings" aria-controls="display-panel-settings" aria-selected="false" tabindex="-1">Settings</button>
            </div>
            <div class="display-panel active" id="display-panel-themes" role="tabpanel" aria-labelledby="display-tab-themes">
                <p class="display-theme-description" data-help="Describes what a theme changes.">A theme is a background plus a set of sounds, icons, and other elements<br>to help you personalize your computer with one click.</p>
                <label class="display-theme-label" for="display-theme">T<span class="menu-accesskey">h</span>eme:</label>
                <select id="display-theme" data-help="Lists the themes you can use. Choosing one changes the background, colors, and window style together."><option value="windows-xp">Windows XP</option><option value="classic">Windows Classic</option></select>
                <span class="display-sample-label">Sample:</span>
                <div class="display-theme-sample" aria-label="Theme sample" data-help="Shows how the selected theme will look.">
                    ${sampleWindow("Active Window", "active", ["minimize", "maximize", "close"], sampleText)}
                    <img src="assets/xp/icons/RecyclerFull.png" alt="">
                </div>
            </div>
            <div class="display-panel" id="display-panel-desktop" role="tabpanel" aria-labelledby="display-tab-desktop" hidden>
                <div class="display-monitor" aria-label="Desktop preview">
                    <img src="assets/xp/DisplaySettings.png" alt="">
                    <div class="display-preview-surface"></div>
                </div>
                <label class="display-wallpaper-label" for="display-wallpaper"><span class="menu-accesskey">B</span>ackground:</label>
                <select id="display-wallpaper" aria-label="Desktop background" hidden>${wallpapers
                  .map(([id, name]) => `<option value="${id}">${name}</option>`)
                  .join("")}</select>
                <div class="display-wallpaper-list" role="listbox" aria-label="Desktop background" data-help="Lists the pictures you can use as your desktop background.">
                    <button type="button" role="option" class="display-custom-wallpaper" data-wallpaper="custom" hidden><span class="wallpaper-icon"></span><span class="display-custom-wallpaper-name"></span></button>
                    ${wallpapers
                      .map(
                        ([id, name]) =>
                          `<button type="button" role="option" data-wallpaper="${id}"><span class="wallpaper-icon${id === "none" ? " none" : ""}"></span><span>${name}</span></button>`,
                      )
                      .join("")}
                </div>
                <button type="button" class="xp-btn display-browse" data-help="Opens a picture from your computer to use as the background."><span class="menu-accesskey">B</span>rowse...</button>
                <input id="display-image" type="file" hidden>
                <label class="display-position-label" for="display-position"><span class="menu-accesskey">P</span>osition:</label>
                <select id="display-position" data-help="Sets how the picture fills the desktop."><option value="center">Center</option><option value="tile">Tile</option><option value="stretch">Stretch</option></select>
                <label class="display-color-label" for="display-color"><span class="menu-accesskey">C</span>olor:</label>
                <label class="display-color-button" for="display-color" data-help="Sets the color shown behind or instead of the picture."><span></span></label>
                <input id="display-color" type="color" value="#004e98" hidden>
                <button type="button" class="xp-btn display-customize" data-help="Chooses which icons appear on the desktop."><span class="menu-accesskey">C</span>ustomize Desktop...</button>
            </div>
            <div class="display-panel" id="display-panel-saver" role="tabpanel" aria-labelledby="display-tab-saver" hidden>
                <div class="display-monitor" aria-label="Screen saver preview">
                    <img src="assets/xp/DisplaySettings.png" alt="">
                    <div class="screen-saver-preview"></div>
                </div>
                <fieldset class="dlg-group display-saver-group"><legend><span class="menu-accesskey">S</span>creen saver</legend>
                    <select id="display-saver" aria-label="Screen saver" data-help="Lists the screen savers you can use."><option value="none">(None)</option><option value="pipes">3D Pipes</option><option value="blank">Blank</option><option value="marquee">Marquee</option><option value="stars">Starfield</option><option value="windows-xp">Windows XP</option></select>
                    <button type="button" class="xp-btn display-saver-settings" data-help="Shows the options for the selected screen saver.">Se<span class="menu-accesskey">t</span>tings</button>
                    <button type="button" class="xp-btn display-saver-preview-button" data-help="Shows the screen saver full screen until you move the mouse or press a key.">Pre<span class="menu-accesskey">v</span>iew</button>
                    <label class="display-saver-wait-label" for="display-saver-wait"><span class="menu-accesskey">W</span>ait:</label>
                    <input id="display-saver-wait" type="number" min="1" max="60" data-help="Sets how many idle minutes pass before the screen saver starts.">
                    <span class="xp-updown display-saver-spin"><button type="button" tabindex="-1" aria-label="More minutes" data-step="1">▲</button><button type="button" tabindex="-1" aria-label="Fewer minutes" data-step="-1">▼</button></span>
                    <span class="display-saver-minutes">minutes</span>
                    <label class="display-saver-login-label" data-help="Shows the Welcome screen when you return from the screen saver."><input type="checkbox" class="display-saver-login"><span>On resume, <span class="menu-accesskey">p</span>assword protect</span></label>
                </fieldset>
            </div>
            <div class="display-panel" id="display-panel-appearance" role="tabpanel" aria-labelledby="display-tab-appearance" hidden>
                <div class="appearance-preview" aria-label="Appearance sample" data-help="Shows how windows look with the selected style and colors.">
                    ${sampleWindow("Inactive Window", "inactive", ["minimize", "maximize", "close"])}
                    ${sampleWindow("Active Window", "active", ["minimize", "maximize", "close"], sampleText)}
                    ${sampleWindow("Message Box", "message", ["close"], '<div class="scheme-face"><span class="xp-btn default">OK</span></div>')}
                </div>
                <label class="display-style-label" for="display-window-style"><span class="menu-accesskey">W</span>indows and buttons:</label>
                <select id="display-window-style" data-help="Chooses Windows XP style windows and buttons, or Windows Classic."><option value="xp">Windows XP style</option><option value="classic">Windows Classic style</option></select>
                <label class="display-scheme-label" for="display-appearance"><span class="menu-accesskey">C</span>olor scheme:</label>
                <select id="display-appearance" data-help="Lists the color schemes for the selected style."><option value="blue">Default (blue)</option><option value="olive">Olive Green</option><option value="silver">Silver</option><option value="classic">Windows Standard</option></select>
                <label class="display-font-label" for="display-font-size"><span class="menu-accesskey">F</span>ont size:</label>
                <select id="display-font-size" data-help="Sets the size of text in windows and menus."><option value="normal">Normal</option><option value="large">Large Fonts</option><option value="extra-large">Extra Large Fonts</option></select>
                <button type="button" class="xp-btn display-effects" data-help="Sets menu effects, font smoothing, and other visual effects."><span class="menu-accesskey">E</span>ffects...</button>
                <button type="button" class="xp-btn display-advanced-appearance" data-help="Changes the desktop color.">A<span class="menu-accesskey">d</span>vanced</button>
            </div>
            <div class="display-panel" id="display-panel-settings" role="tabpanel" aria-labelledby="display-tab-settings" hidden>
                <div class="display-monitor" aria-label="Display preview">
                    <img src="assets/xp/DisplaySettings.png" alt="">
                </div>
                <span class="display-adapter-label">Display:</span>
                <span class="display-adapter">Default Monitor on Web Browser</span>
                <fieldset class="dlg-group display-resolution-group"><legend><span class="menu-accesskey">S</span>creen resolution</legend>
                    <span class="display-resolution-less">Less</span>
                    <input id="display-resolution-slider" type="range" min="0" max="3" step="1" aria-label="Screen resolution" data-help="Sets the screen size. The last stop fills the browser window.">
                    <span class="display-resolution-more">More</span>
                    <select id="display-resolution" hidden><option value="800x600">800 by 600 pixels</option><option value="1024x768">1024 by 768 pixels</option><option value="1440x900">1440 by 900 pixels</option><option value="auto">Use browser size</option></select>
                    <p class="display-resolution-value"></p>
                </fieldset>
                <fieldset class="dlg-group display-color-quality-group"><legend><span class="menu-accesskey">C</span>olor quality</legend>
                    <select id="display-color-quality" aria-label="Color quality" data-help="Shows the number of colors your screen uses."></select>
                    <img class="display-color-bar" src="assets/xp/ColorQuality.png" alt="">
                </fieldset>
            </div>
            <div class="display-dialog-buttons">
                <button type="button" class="xp-btn default" data-display-action="ok">OK</button>
                <button type="button" class="xp-btn" data-display-action="cancel">Cancel</button>
                <button type="button" class="xp-btn" data-display-action="apply" disabled><span class="menu-accesskey">A</span>pply</button>
            </div>
        `;
      return content;
    },
    "__internet-games": (win) => {
      const content = createSystemContentRoot();

      content.className = "internet-games-content";
      content.innerHTML = `
      <header class="internet-games-header">
        <div>
          <h1>Internet Games</h1>
          <p>Find more Flash games in the Flashpoint Archive.</p>
        </div>
        <img src="assets/xp/icons/AddRemovePrograms.png" alt="">
      </header>
      <div class="internet-games-tabs" role="tablist" aria-label="Internet Games">
        <button type="button" role="tab" aria-selected="true" data-internet-tab="browse">Find Games</button>
        <button type="button" role="tab" aria-selected="false" tabindex="-1" data-internet-tab="installed">Installed</button>
      </div>
      <section class="internet-games-panel" data-internet-panel="browse">
        <form class="internet-games-search" role="search">
          <label for="internet-games-query">Game name:</label>
          <span>
            <input id="internet-games-query" class="xp-input" type="search" maxlength="100" autocomplete="off" placeholder="Try Bike Mania">
            <button class="xp-btn default" type="submit">Search</button>
          </span>
        </form>
        <p class="internet-games-status" aria-live="polite"></p>
        <div class="internet-games-results" aria-label="Game results"></div>
      </section>
      <section class="internet-games-panel" data-internet-panel="installed" hidden>
        <p class="internet-games-installed-status" aria-live="polite"></p>
        <div class="internet-games-installed"></div>
      </section>
    `;
      return content;
    },
    __search: (win) => {
      const content = createSystemContentRoot();

      content.className = "search-companion-content";
      content.innerHTML = `
            <div class="explorer-chrome search-explorer-chrome">
                <div class="explorer-menu-row">
                    <div class="explorer-menu-bar" role="menubar"><button>File</button><button>Edit</button><button>View</button><button>Favorites</button><button>Tools</button><button>Help</button></div>
                    <div class="explorer-brand" aria-hidden="true"><img src="assets/xp/WindowsFlag.png" alt=""></div>
                </div>
                <div class="explorer-toolbar">
                    <button disabled><img src="assets/xp/explorer/toolbar-back.png" alt=""> Back <span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
                    <button disabled aria-label="Forward"><img src="assets/xp/explorer/toolbar-forward.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
                    <button disabled aria-label="Up"><img src="assets/xp/explorer/toolbar-up.png" alt=""></button>
                    <span class="explorer-toolbar-separator" aria-hidden="true"></span>
                    <button class="search-toolbar-active"><img src="assets/xp/explorer/toolbar-search.png" alt=""> Search</button>
                    <button><img src="assets/xp/explorer/toolbar-folders.png" alt=""> Folders</button>
                    <span class="explorer-toolbar-separator" aria-hidden="true"></span>
                    <button aria-label="Views"><img src="assets/xp/explorer/toolbar-views.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
                </div>
                <label class="explorer-address"><span>Address</span><span class="explorer-address-field"><img src="assets/xp/icons/Search.png" alt=""><input type="text" aria-label="Address" value="Search Results" readonly></span><button type="button" aria-label="Go"><img src="assets/xp/icons/Go.png" alt=""></button></label>
            </div>
            <div class="search-column-header"><span>Search Companion</span><span><b>Name</b><b>In Folder</b><b>Size</b><b>Type</b></span></div>
            <div class="search-companion-body">
                <aside class="search-companion-panel">
                    <section class="search-start-panel">
                        <strong>What do you want to search for?</strong>
                        <button type="button" data-search-kind="media">Pictures, music, or video</button>
                        <button type="button" data-search-kind="documents">Documents (word processing, spreadsheet, etc.)</button>
                        <button type="button" data-search-kind="all">All files and folders</button>
                        <button type="button" data-search-kind="people">Computers or people</button>
                        <span>You may also want to...</span>
                        <button type="button" data-search-extra>Search the Internet</button>
                        <button type="button" data-search-extra>Change preferences</button>
                        <button type="button" data-search-extra>Turn off animated character</button>
                    </section>
                    <section class="search-form-panel" hidden>
                        <button type="button" class="search-back" data-search-action="back">Back</button>
                        <strong>Search by any or all of the criteria below.</strong>
                        <label for="search-filename">All or part of the file name:</label>
                        <input id="search-filename" class="xp-input" type="search" autocomplete="off">
                        <label for="search-location">Look in:</label>
                        <select id="search-location" class="xp-input"></select>
                        <label for="search-type">What do you want to find?</label>
                        <select id="search-type" class="xp-input">
                            <option value="all">All files and folders</option>
                            <option value="files">Files</option>
                            <option value="folders">Folders</option>
                            <option value="games">Games</option>
                            <option value="applications">Applications</option>
                        </select>
                        <button type="button" class="xp-btn default" data-search-action="search">Search</button>
                    </section>
                    <img class="search-dog" src="assets/xp/SearchDog.bmp" alt="">
                </aside>
                <main class="search-results-pane">
                    <p class="search-results-status" aria-live="polite">To start your search, follow the instructions in the left pane.</p>
                    <div class="search-results-list" role="listbox" aria-label="Search results"></div>
                </main>
            </div>
        `;
      return content;
    },
    explorer: (shortcutId, win) => {
      const content = createSystemContentRoot();

      const taskTitles = {
        "__my-documents": "File and Folder Tasks",
        "__my-pictures": "Picture Tasks",
        "__my-music": "Music Tasks",
        "__my-computer": "System Tasks",
        "__recycle-bin": "Recycle Bin Tasks",
      };

      const sidebar = document.createElement("aside");
      sidebar.className = "explorer-sidebar";

      const tasksSection = document.createElement("section");
      const tasksTitle = document.createElement("h3");
      tasksTitle.innerHTML = `<button type="button" class="explorer-section-toggle" aria-expanded="true"><span class="explorer-section-label">${taskTitles[shortcutId]}</span><span aria-hidden="true">⌃</span></button>`;
      const tasksBody = document.createElement("div");
      tasksBody.className = "explorer-section-body";
      tasksSection.append(tasksTitle, tasksBody);
      // Explorer fills in the tasks for the folder being shown.

      const sidebarSection = (className, title) => {
        const section = document.createElement("section");
        section.className = className;
        section.innerHTML = `<h3><button type="button" class="explorer-section-toggle" aria-expanded="true">${title}<span aria-hidden="true">⌃</span></button></h3>`;
        const body = document.createElement("div");
        body.className = "explorer-section-body";
        section.appendChild(body);
        return section;
      };
      // Explorer fills these in for the folder being shown.
      const placesSection = sidebarSection(
        "explorer-places-section",
        "Other Places",
      );
      const detailsSection = sidebarSection(
        "explorer-details-section",
        "Details",
      );

      sidebar.append(tasksSection, placesSection, detailsSection);
      const treeSection = document.createElement("section");
      treeSection.className = "explorer-tree-section";
      treeSection.innerHTML = "<h3>Folders</h3>";
      const tree = document.createElement("div");
      tree.className = "explorer-tree";
      tree.setAttribute("role", "tree");
      treeSection.appendChild(tree);
      sidebar.appendChild(treeSection);
      sidebar.querySelectorAll(".explorer-section-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
          const section = toggle.closest("section");
          const collapsed = section.classList.toggle("collapsed");
          toggle.setAttribute("aria-expanded", String(!collapsed));
          toggle.querySelector("[aria-hidden]").textContent = collapsed
            ? "⌄"
            : "⌃";
        });
      });
      const main = document.createElement("main");
      main.className = "explorer-main";

      const heading = document.createElement("h2");
      main.appendChild(heading);

      const items = document.createElement("div");
      items.className = "explorer-items";
      items.tabIndex = 0;
      main.appendChild(items);
      // Clicking empty space clears the selection, like XP.
      main.addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".explorer-item")) {
          items.focus({ preventScroll: true });
          items
            .querySelectorAll(".explorer-item.selected")
            .forEach((item) => item.classList.remove("selected"));
          renderExplorerSelection(win);
        }
      });

      const chrome = document.createElement("div");
      chrome.className = "explorer-chrome";
      chrome.innerHTML = `
        <div class="explorer-menu-row">
            <div class="explorer-menu-bar" role="menubar"><button data-explorer-menu="file">File</button><button data-explorer-menu="edit">Edit</button><button data-explorer-menu="view">View</button><button data-explorer-menu="help">Help</button></div>
            <div class="explorer-brand" aria-hidden="true"><img src="assets/xp/WindowsFlag.png" alt=""></div>
        </div>
        <div class="explorer-toolbar">
            <button data-explorer-action="back"><img src="assets/xp/explorer/toolbar-back.png" alt=""> Back <span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
            <button data-explorer-action="forward" aria-label="Forward"><img src="assets/xp/explorer/toolbar-forward.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
            <button data-explorer-action="up" aria-label="Up"><img src="assets/xp/explorer/toolbar-up.png" alt=""></button>
            <span class="explorer-toolbar-separator" aria-hidden="true"></span>
            <button data-explorer-action="search"><img src="assets/xp/explorer/toolbar-search.png" alt=""> Search</button>
            <button data-explorer-action="folders" aria-pressed="false"><img src="assets/xp/explorer/toolbar-folders.png" alt=""> Folders</button>
            <span class="explorer-toolbar-separator" aria-hidden="true"></span>
            <button data-explorer-action="view" aria-label="Views"><img src="assets/xp/explorer/toolbar-views.png" alt=""><span class="toolbar-drop-arrow" aria-hidden="true">▾</span></button>
        </div>
        <label class="explorer-address"><span>Address</span><span class="explorer-address-field"><img src="assets/xp/icons/MyComputer.png" alt=""><input type="text" aria-label="Address"></span><button type="button" data-explorer-action="go" aria-label="Go"><img src="assets/xp/icons/Go.png" alt=""></button></label>
    `;
      const body = document.createElement("div");
      body.className = "explorer-body";
      body.append(sidebar, main);
      const status = document.createElement("div");
      status.className = "explorer-status";
      status.hidden = true;
      content.append(chrome, body, status);
      const explorerMenu = document.createElement("div");
      explorerMenu.className = "game-menu explorer-menu";
      explorerMenu.setAttribute("role", "menu");
      explorerMenu.hidden = true;
      chrome.appendChild(explorerMenu);
      const explorerSubmenu = document.createElement("div");
      explorerSubmenu.className = "game-menu explorer-menu explorer-submenu";
      explorerSubmenu.setAttribute("role", "menu");
      explorerSubmenu.hidden = true;
      chrome.appendChild(explorerSubmenu);
      const explorerMenuLabels = {
        file: "&File",
        edit: "&Edit",
        view: "&View",
        favorites: "F&avorites",
        tools: "&Tools",
        help: "&Help",
      };
      const explorerMenuButtons = [
        ...chrome.querySelectorAll("[data-explorer-menu]"),
      ];
      const explorerSubmenus = {
        "folder-menu": [
          { label: "Search...", action: "search-current" },

          { separator: true },

          { separator: true },

          { separator: true },
          { label: "Properties", action: "properties-current" },
        ],

        "explorer-bar": [
          { label: "Search", action: "search-current", shortcut: "Ctrl+E" },

          { label: "Folders", action: "folders-bar", checked: true },
          { separator: true },
        ],

        "go-to": [
          { label: "Up One Level", action: "up-one-level" },
          { separator: true },

          { separator: true },
          { label: "My Computer", action: "my-computer", checked: true },
        ],
      };
      explorerMenuButtons.forEach((button) => {
        const { key } = setAccessKeyText(
          button,
          explorerMenuLabels[button.dataset.explorerMenu],
        );
        button.dataset.accessKey = key;
        button.setAttribute("role", "menuitem");
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
      });
      const renderExplorerMenuEntries = (menu, entries, commandAttribute) => {
        menu.replaceChildren();
        entries
          .filter(
            (entry, index) =>
              !entry.separator ||
              (index > 0 &&
                index < entries.length - 1 &&
                !entries[index - 1].separator),
          )
          .forEach((entry) => {
            if (entry.separator) {
              const separator = document.createElement("div");
              separator.className = "game-menu-separator";
              separator.setAttribute("role", "separator");
              menu.appendChild(separator);
              return;
            }
            const item = document.createElement("button");
            item.type = "button";
            item.className = "game-menu-item";
            item.dataset[commandAttribute] = entry.action;
            item.disabled = !!entry.disabled;
            item.setAttribute("role", "menuitem");
            if (entry.checked) item.classList.add("checked");
            if (entry.radio || entry.checked) {
              const check = document.createElement("span");
              check.className = "menu-check explorer-menu-radio";
              check.textContent = entry.checked
                ? entry.radio
                  ? "•"
                  : "✓"
                : "";
              item.appendChild(check);
            }
            const label = document.createElement("span");
            label.textContent = entry.label;
            item.appendChild(label);
            if (entry.shortcut) {
              const shortcut = document.createElement("span");
              shortcut.className = "menu-shortcut";
              shortcut.textContent = entry.shortcut;
              item.appendChild(shortcut);
            }
            if (entry.submenu) {
              item.classList.add("has-submenu");
              item.setAttribute("aria-haspopup", "menu");
              const arrow = document.createElement("span");
              arrow.className = "explorer-menu-arrow";
              arrow.textContent = "▶";
              item.appendChild(arrow);
            }
            menu.appendChild(item);
          });
      };
      const showExplorerSubmenu = (name, parentItem, focusFirst) => {
        renderExplorerMenuEntries(
          explorerSubmenu,
          explorerSubmenus[name],
          "explorerSubcommand",
        );
        explorerSubmenu.dataset.explorerSubmenuName = name;
        explorerSubmenu.dataset.parentCommand = name;
        explorerSubmenu.style.left = `${explorerMenu.offsetLeft + explorerMenu.offsetWidth - 3}px`;
        explorerSubmenu.style.top = `${explorerMenu.offsetTop + parentItem.offsetTop - 1}px`;
        explorerSubmenu.hidden = false;
        if (focusFirst)
          explorerSubmenu.querySelector("button:not(:disabled)")?.focus();
      };
      // My Computer and the Recycle Bin are the only folders without a
      // parent, and XP shows the Desktop above both.
      const navigateUp = () =>
        navigateExplorer(
          win,
          (fs.getParent(win.currentFolderId) || fs.getNode(fs.DESKTOP)).id,
        );
      const showExplorerMenu = (name, button, focusFirst) => {
        const selected = selectedExplorerNodes(win);
        const protectedSelection = selected.some((id) => fs.isProtected(id));
        const writable = ![fs.RECYCLE_BIN, fs.MY_COMPUTER].includes(
          win.currentFolderId,
        );
        const currentFolderName = fs.getNode(win.currentFolderId).name;
        const actions = {
          file: [
            {
              label: "Delete",
              action:
                win.currentFolderId === fs.MY_COMPUTER
                  ? "delete-current"
                  : "delete",
              disabled:
                win.currentFolderId !== fs.MY_COMPUTER &&
                (!selected.length || protectedSelection),
            },
            {
              label: "Rename",
              action:
                win.currentFolderId === fs.MY_COMPUTER
                  ? "rename-current"
                  : "rename",
              // Items in the Recycle Bin keep their names until restored.
              disabled:
                win.currentFolderId !== fs.MY_COMPUTER &&
                (selected.length !== 1 ||
                  protectedSelection ||
                  win.currentFolderId === fs.RECYCLE_BIN),
            },
            { label: "Properties", action: "properties-current" },
            { separator: true },
            { label: currentFolderName, action: "folder-menu", submenu: true },
            { separator: true },
            { label: "Close", action: "close" },
          ],
          edit: [
            { separator: true },
            {
              label: "Cut",
              action: "cut",
              shortcut: "Ctrl+X",
              disabled: !selected.length || protectedSelection,
            },
            {
              label: "Copy",
              action: "copy",
              shortcut: "Ctrl+C",
              disabled: !selected.length,
            },
            {
              label: "Paste",
              action: "paste",
              shortcut: "Ctrl+V",
              disabled: !writable || !fileOps.canPaste(win.currentFolderId),
            },

            { separator: true },
            { label: "Select All", action: "select-all", shortcut: "Ctrl+A" },
            { label: "Invert Selection", action: "invert-selection" },
          ],
          view: [
            { label: "Explorer Bar", action: "explorer-bar", submenu: true },
            { separator: true },
            {
              label: "Thumbnails",
              action: "thumbnails",
              radio: true,
              checked: win.explorerView === "thumbnails",
            },
            {
              label: "Tiles",
              action: "tiles",
              radio: true,
              checked: win.explorerView === "tiles",
            },
            {
              label: "Icons",
              action: "icons",
              radio: true,
              checked: win.explorerView === "icons",
            },
            {
              label: "List",
              action: "list",
              radio: true,
              checked: win.explorerView === "list",
            },
            {
              label: "Details",
              action: "details",
              radio: true,
              checked: win.explorerView === "details",
            },
            { separator: true },

            { separator: true },

            { label: "Go To", action: "go-to", submenu: true },
            { label: "Refresh", action: "refresh" },
          ],

          help: [
            { separator: true },

            { label: "About Windows", action: "about-windows" },
          ],
        }[name];
        explorerMenu.dataset.explorerMenuName = name;
        renderExplorerMenuEntries(explorerMenu, actions, "explorerCommand");
        explorerSubmenu.hidden = true;
        explorerMenu.hidden = false;
        explorerMenuButtons.forEach((entry) =>
          entry.setAttribute("aria-expanded", String(entry === button)),
        );
        explorerMenu.style.left = `${button.offsetLeft}px`;
        explorerMenu.style.top = `${button.offsetTop + button.offsetHeight}px`;
        if (focusFirst)
          explorerMenu.querySelector("button:not(:disabled)")?.focus();
      };
      chrome.addEventListener("click", async (event) => {
        try {
          const menuButton = event.target.closest("[data-explorer-menu]");
          const menuName = menuButton?.dataset.explorerMenu;
          if (menuName) {
            showExplorerMenu(menuName, menuButton, false);
            return;
          }
          const commandButton = event.target.closest("[data-explorer-command]");
          const command = commandButton?.dataset.explorerCommand;
          if (command) {
            if (commandButton.classList.contains("has-submenu")) {
              showExplorerSubmenu(command, commandButton, false);
              return;
            }
            const selected = selectedExplorerNodes(win);
            if (command === "close") closeGameWindow(win.gameId);
            if (command === "cut") fileOps.cut(selected);
            if (command === "copy") fileOps.copy(selected);
            if (
              command === "paste" &&
              ![fs.RECYCLE_BIN, fs.MY_COMPUTER].includes(win.currentFolderId)
            )
              pasteIntoFolder(win.currentFolderId);
            // In the Recycle Bin, Delete removes items for good, like the
            // Delete key.
            if (command === "delete")
              await (win.currentFolderId === fs.RECYCLE_BIN
                ? confirmPermanentDelete(selected)
                : confirmRecycleDelete(selected));
            if (command === "delete-current" || command === "rename-current")
              XPDialogs.alert(
                `Cannot ${command === "delete-current" ? "delete" : "rename"} My Computer.`,
                "Windows Explorer",
                "info",
              );
            if (command === "rename") startExplorerRename(win, selected[0]);
            if (
              ["thumbnails", "tiles", "icons", "list", "details"].includes(
                command,
              )
            ) {
              win.explorerView = command;
              renderExplorerItems(win);
            }
            if (command === "properties-current")
              openShellProperties(selected[0] || win.currentFolderId);
            if (command === "select-all")
              win.el
                .querySelectorAll(".explorer-item")
                .forEach((item) => item.classList.add("selected"));
            if (command === "invert-selection")
              win.el
                .querySelectorAll(".explorer-item")
                .forEach((item) => item.classList.toggle("selected"));
            if (command === "refresh") renderExplorerItems(win);

            if (command === "about-windows") openAboutWindows();
            explorerMenu.hidden = true;
            explorerSubmenu.hidden = true;
            explorerMenuButtons.forEach((button) =>
              button.setAttribute("aria-expanded", "false"),
            );
            return;
          }
          const subcommandButton = event.target.closest(
            "[data-explorer-subcommand]",
          );
          const subcommand = subcommandButton?.dataset.explorerSubcommand;
          if (subcommand) {
            if (subcommand === "search-current") openSearchDialog();
            if (subcommand === "folders-bar") {
              content.classList.add("folders-visible");
              chrome
                .querySelector('[data-explorer-action="folders"]')
                ?.setAttribute("aria-pressed", "true");
            }
            if (subcommand === "up-one-level") navigateUp();
            if (subcommand === "my-computer")
              navigateExplorer(win, fs.MY_COMPUTER);
            if (subcommand === "properties-current")
              openShellProperties(win.currentFolderId);

            explorerMenu.hidden = true;
            explorerSubmenu.hidden = true;
            explorerMenuButtons.forEach((button) =>
              button.setAttribute("aria-expanded", "false"),
            );
            return;
          }
          const actionButton = event.target.closest("[data-explorer-action]");
          const action = actionButton?.dataset.explorerAction;
          if (!action) return;
          if (action === "back") explorerBack(win);
          if (action === "forward") explorerForward(win);
          if (action === "up") navigateUp();
          if (action === "folders") {
            const foldersVisible = content.classList.toggle("folders-visible");
            actionButton.setAttribute("aria-pressed", String(foldersVisible));
          }
          if (action === "view") {
            const views = ["tiles", "thumbnails", "icons", "list", "details"];
            win.explorerView =
              views[(views.indexOf(win.explorerView) + 1) % views.length];
            renderExplorerItems(win);
          }
          if (action === "search") openSearchDialog();
          if (action === "go") {
            const input = chrome.querySelector(".explorer-address input");
            // Explorer opens only folders, never one in the Recycle Bin.
            // Otherwise the address goes back to the open folder.
            if (!navigateExplorer(win, fs.resolvePath(input.value)))
              input.value = fs.getPath(win.currentFolderId);
          }
        } catch (error) {
          await XPDialogs.alert(
            error.message || "The file operation failed.",
            "File operation",
            "error",
          );
        }
      });
      explorerMenu.addEventListener("pointerover", (event) => {
        const parentItem = event.target.closest(".has-submenu");
        if (parentItem)
          showExplorerSubmenu(
            parentItem.dataset.explorerCommand,
            parentItem,
            false,
          );
        else if (event.target.closest(".game-menu-item"))
          explorerSubmenu.hidden = true;
      });
      chrome.querySelector("input").addEventListener("change", (event) => {
        const destination = fs.resolvePath(event.target.value);
        if (destination && fs.getNode(destination)?.type === "folder")
          navigateExplorer(win, destination);
        else event.target.value = fs.getPath(win.currentFolderId);
      });
      chrome.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          const activeButton = explorerMenuButtons.find(
            (button) => button.getAttribute("aria-expanded") === "true",
          );
          explorerMenu.hidden = true;
          explorerSubmenu.hidden = true;
          explorerMenuButtons.forEach((button) =>
            button.setAttribute("aria-expanded", "false"),
          );
          activeButton?.focus();
          return;
        }
        const heading = document.activeElement?.closest?.(
          "[data-explorer-menu]",
        );
        if (event.altKey) {
          const target = explorerMenuButtons.find(
            (button) => button.dataset.accessKey === event.key.toLowerCase(),
          );
          if (target) {
            event.preventDefault();
            showExplorerMenu(target.dataset.explorerMenu, target, true);
          }
          return;
        }
        if (
          heading &&
          ["ArrowLeft", "ArrowRight", "ArrowDown", "Home", "End"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const index = explorerMenuButtons.indexOf(heading);
          const target =
            event.key === "Home"
              ? explorerMenuButtons[0]
              : event.key === "End"
                ? explorerMenuButtons.at(-1)
                : event.key === "ArrowDown"
                  ? heading
                  : explorerMenuButtons[
                      (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        explorerMenuButtons.length) %
                        explorerMenuButtons.length
                    ];
          if (event.key === "ArrowDown")
            showExplorerMenu(heading.dataset.explorerMenu, heading, true);
          else {
            target.focus();
            showExplorerMenu(target.dataset.explorerMenu, target, true);
          }
          return;
        }
        const menuItems = [
          ...explorerMenu.querySelectorAll("button:not(:disabled)"),
        ];
        const activeMenuItem = document.activeElement?.closest?.(
          "[data-explorer-command]",
        );
        if (
          event.key === "ArrowRight" &&
          activeMenuItem?.classList.contains("has-submenu")
        ) {
          event.preventDefault();
          showExplorerSubmenu(
            activeMenuItem.dataset.explorerCommand,
            activeMenuItem,
            true,
          );
          return;
        }
        const activeSubmenuItem = document.activeElement?.closest?.(
          "[data-explorer-subcommand]",
        );
        if (event.key === "ArrowLeft" && activeSubmenuItem) {
          event.preventDefault();
          const parent = explorerMenu.querySelector(
            `[data-explorer-command="${CSS.escape(explorerSubmenu.dataset.parentCommand)}"]`,
          );
          explorerSubmenu.hidden = true;
          parent?.focus();
          return;
        }
        const submenuItems = [
          ...explorerSubmenu.querySelectorAll("button:not(:disabled)"),
        ];
        if (
          !explorerSubmenu.hidden &&
          activeSubmenuItem &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const index = submenuItems.indexOf(activeSubmenuItem);
          const target =
            event.key === "Home"
              ? submenuItems[0]
              : event.key === "End"
                ? submenuItems.at(-1)
                : submenuItems[
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      submenuItems.length) %
                      submenuItems.length
                  ];
          target?.focus();
          return;
        }
        if (
          !explorerMenu.hidden &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const index = menuItems.indexOf(document.activeElement);
          const target =
            event.key === "Home"
              ? menuItems[0]
              : event.key === "End"
                ? menuItems.at(-1)
                : menuItems[
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      menuItems.length) %
                      menuItems.length
                  ];
          target?.focus();
        }
        if (
          event.key === "Enter" &&
          !explorerMenu.hidden &&
          document.activeElement?.matches("[data-explorer-command]")
        ) {
          event.preventDefault();
          document.activeElement.click();
        }
      });
      renderExplorerItems(win, content);
      renderExplorerTree(win);
      return content;
    },
  });

  const createSystemWindowContent = (shortcutId, win) =>
    (XP_SYSTEM_RENDERERS[shortcutId] || XP_SYSTEM_RENDERERS.explorer)(
      shortcutId,
      win,
    );

  const activators = Object.freeze({
    "display-properties": context.wireDisplayProperties,
    "project-settings": wireProjectSettings,
    search: context.wireSearchCompanion,
    "internet-games": context.wireInternetGames,
    "control-panel": controlPanel.wire,
  });

  return Object.freeze({
    render: createSystemWindowContent,
    activate(name, win) {
      activators[name]?.(win);
    },
  });
};
