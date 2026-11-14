// @ts-nocheck -- Start menu layout details compared against the XP SP3 VM.
import { afterEach, expect, test } from "bun:test";
import { cleanupShells, loadShell, login } from "./helpers/shell-harness";
afterEach(cleanupShells);

const press = (s, key) =>
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key, bubbles: true }),
  );
const pointerDown = (s) =>
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );

test("access-key underlines appear only after the keyboard is used", async () => {
  const s = await login(await loadShell());
  const menu = s.document.getElementById("start-menu");
  const flyouts = s.document.getElementById("start-menu-flyouts");

  pointerDown(s);
  s.document.getElementById("start-button").click();
  expect(menu.classList.contains("keyboard-cues")).toBeFalse();
  press(s, "ArrowDown");
  expect(menu.classList.contains("keyboard-cues")).toBeTrue();
  expect(flyouts.classList.contains("keyboard-cues")).toBeTrue();

  s.document.getElementById("start-button").click();
  pointerDown(s);
  s.document.getElementById("start-button").click();
  expect(menu.classList.contains("keyboard-cues")).toBeFalse();

  s.document.getElementById("start-button").click();
  press(s, "Shift");
  s.document.getElementById("start-button").click();
  expect(menu.classList.contains("keyboard-cues")).toBeTrue();
});

test("the right column groups places like XP", async () => {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  const places = s.document.getElementById("start-menu-places");
  const groups = [...places.children].map((item) =>
    item.classList.contains("sm-place-separator")
      ? "|"
      : `${item.dataset.startAction}${item.classList.contains("sm-place-primary") ? "*" : ""}`,
  );
  expect(groups).toEqual([
    "documents*",
    "recent*",
    "pictures*",
    "music*",
    "computer*",
    "|",
    "controlPanel",
    "|",
    "search",
    "run",
  ]);
  expect(
    places
      .querySelector('[data-start-action="recent"]')
      .getAttribute("aria-haspopup"),
  ).toBe("menu");
});

test("Internet Games is pinned with its source and a separator", async () => {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  const pinned = s.document.querySelector("#start-menu-pinned .sm-pinned");
  expect(pinned.querySelector(".sm-game-title").textContent).toBe(
    "Internet Games",
  );
  expect(pinned.querySelector(".sm-pinned-subtitle").textContent).toBe(
    "Flashpoint Archive",
  );
  expect(
    pinned.nextElementSibling.classList.contains("sm-pinned-separator"),
  ).toBeTrue();
});

test("All Programs grows upward from its button", async () => {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  const button = s.document.getElementById("all-programs-button");
  button.getBoundingClientRect = () => ({
    top: 668,
    bottom: 692,
    left: 8,
    right: 145,
    width: 137,
    height: 24,
  });
  s.document.getElementById("taskbar").getBoundingClientRect = () => ({
    top: 738,
  });
  Object.defineProperty(s.window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.classList.contains("start-program-flyout") ? 100 : 0;
    },
  });
  try {
    button.click();
    const panel = s.document.querySelector(".start-program-flyout");
    expect(panel.style.top).toBe("592px");
    expect(panel.style.left).toBe("145px");
  } finally {
    delete s.window.HTMLElement.prototype.offsetHeight;
  }
});

const rightClick = (s, element) =>
  element.dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 750,
    }),
  );
const placeIds = (s) =>
  [...s.document.querySelectorAll("#start-menu-places .sm-place")].map(
    (item) => item.dataset.startAction || item.textContent,
  );

test("the Start button has its own menu with Search and Properties", async () => {
  const s = await login(await loadShell());
  const menu = s.document.getElementById("start-button-menu");
  rightClick(s, s.document.getElementById("start-button"));
  expect(menu.hidden).toBeFalse();
  expect(menu.textContent.replace(/\s+/g, " ").trim()).toBe(
    "Search... Properties",
  );
  expect(s.document.getElementById("taskbar-context-menu").hidden).toBeTrue();

  menu.querySelector('[data-start-button-action="search"]').click();
  expect(menu.hidden).toBeTrue();
  expect(
    s.document.querySelector('.xp-window[data-game="__search"]'),
  ).not.toBeNull();

  rightClick(s, s.document.getElementById("start-button"));
  menu.querySelector('[data-start-button-action="properties"]').click();
  const dialog = s.document.querySelector(".taskbar-properties-dialog");
  expect(
    dialog
      .querySelector('[data-taskbar-properties-tab="start-menu"]')
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    dialog.querySelector('[data-taskbar-properties-panel="start-menu"]').hidden,
  ).toBeFalse();
});

test("Customize Start Menu changes the menu it describes", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        gameStats: JSON.stringify({
          "big-truck-adventures": { plays: 1, lastPlayed: 5 },
        }),
      },
    }),
  );
  const openCustomize = () => {
    rightClick(s, s.document.getElementById("start-button"));
    s.document.querySelector('[data-start-button-action="properties"]').click();
    s.document.querySelector(".taskbar-start-customize").click();
    return s.document.querySelector(".customize-start-menu-dialog");
  };

  let dialog = openCustomize();
  dialog.querySelector('[name="start-icon-size"][value="small"]').click();
  dialog.querySelector(".customize-program-count input").value = "2";
  dialog.querySelector(".customize-internet input").click();
  dialog.querySelector('[data-customize-tab="advanced"]').click();
  expect(
    dialog.querySelector('[data-customize-panel="advanced"]').hidden,
  ).toBeFalse();
  dialog.querySelector(".customize-hover-open").click();
  dialog.querySelector(".customize-run").click();
  dialog.querySelector('[name="start-item-music"][value="none"]').click();
  dialog.querySelector('[name="start-item-computer"][value="menu"]').click();
  dialog
    .querySelector('[name="start-item-controlPanel"][value="menu"]')
    .click();
  dialog.querySelector('[data-action="ok"]').click();
  s.document
    .querySelectorAll(".taskbar-properties-dialog [data-action='cancel']")
    .forEach((button) => button.click());

  s.document.getElementById("start-button").click();
  const pinned = s.document.getElementById("start-menu-pinned");
  expect(pinned.classList.contains("sm-small-icons")).toBeTrue();
  expect(pinned.querySelector(".sm-pinned")).toBeNull();
  expect(pinned.querySelectorAll(".sm-game")).toHaveLength(2);
  expect(placeIds(s)).toEqual([
    "documents",
    "recent",
    "pictures",
    "computer",
    "controlPanel",
    "search",
  ]);

  const computer = s.document.querySelector('[data-start-action="computer"]');
  computer.dispatchEvent(new s.window.PointerEvent("pointerenter"));
  await s.advanceTime(300);
  expect(s.document.querySelector(".start-program-flyout")).toBeNull();
  computer.click();
  expect(
    s.document.querySelector(".start-program-flyout").textContent,
  ).toContain("Local Disk (C:)");
  s.document.querySelector('[data-start-action="controlPanel"]').click();
  expect(
    s.document.querySelector(".start-program-flyout").textContent,
  ).toContain("Taskbar and Start Menu");

  dialog = openCustomize();
  dialog.querySelector(".customize-clear-programs").click();
  dialog.querySelector('[data-customize-tab="advanced"]').click();
  dialog.querySelector(".customize-clear-recent").click();
  expect(dialog.querySelector(".customize-clear-recent").disabled).toBeTrue();
  dialog.querySelector(".customize-list-recent input").click();
  dialog.querySelector('[data-action="cancel"]').click();
  s.document.getElementById("start-button").click();
  s.document.getElementById("start-button").click();
  s.document.querySelector('[data-start-action="recent"]').click();
  expect(
    s.document.querySelector(".start-program-flyout .start-program-empty"),
  ).not.toBeNull();
});

test("folder menus list subfolders and open files", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        startMenuOptions: JSON.stringify({ items: { documents: "menu" } }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  fs.createFolder(fs.MY_DOCUMENTS, "Notes");
  fs.createFile(fs.MY_DOCUMENTS, "todo.txt", { content: "milk" });
  s.document.getElementById("start-button").click();
  s.document.querySelector('[data-start-action="documents"]').click();
  const labels = [
    ...s.document.querySelectorAll(".start-program-flyout button"),
  ].map((button) => button.textContent.replace("▶", "").trim());
  expect(labels).toEqual(["My Music", "My Pictures", "Notes", "todo.txt"]);
  s.document.querySelectorAll(".start-program-flyout button")[2].click();
  expect(
    s.document.querySelectorAll(".start-program-flyout")[1].textContent,
  ).toBe("(Empty)");
  [...s.document.querySelectorAll(".start-program-flyout button")]
    .find((button) => button.textContent.includes("todo.txt"))
    .click();
  expect(s.document.querySelector(".xp-window")).not.toBeNull();
});

test("Customize Classic Start Menu toggles Run, expansion, and small icons", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        startMenuStyle: "classic",
        gameStats: JSON.stringify({
          "big-truck-adventures": { plays: 1, lastPlayed: 5 },
        }),
      },
    }),
  );
  rightClick(s, s.document.getElementById("start-button"));
  s.document.querySelector('[data-start-button-action="properties"]').click();
  s.document.querySelector(".taskbar-classic-customize").click();
  const dialog = s.document.querySelector(
    ".customize-classic-start-menu-dialog",
  );
  for (const id of [
    "classic-run",
    "expand-controlPanel",
    "expand-documents",
    "expand-pictures",
    "classic-small-icons",
  ])
    dialog.querySelector(`[data-classic-option="${id}"]`).click();
  dialog.querySelector('[data-action="ok"]').click();

  s.document.getElementById("start-button").click();
  expect(
    s.document
      .getElementById("start-menu")
      .classList.contains("classic-small-icons"),
  ).toBeTrue();
  expect(
    s.document.querySelector('#start-menu-places [data-start-action="run"]'),
  ).toBeNull();
  const places = [
    ...s.document.querySelectorAll("#start-menu-places .sm-place"),
  ];
  places[0].click();
  const documents = s.document.querySelector(".start-program-flyout");
  expect(documents.textContent).toContain("Big Truck Adventures");
  expect(documents.querySelectorAll(".start-program-folder").length).toBe(2);
  places[1].click();
  expect(
    s.document.querySelector(".start-program-flyout .start-program-folder")
      .textContent,
  ).toContain("Control Panel");

  rightClick(s, s.document.getElementById("start-button"));
  s.document.querySelector('[data-start-button-action="properties"]').click();
  s.document.querySelector(".taskbar-classic-customize").click();
  const clear = s.document.querySelector(".customize-classic-clear");
  clear.click();
  expect(clear.disabled).toBeTrue();
  s.document
    .querySelector(
      '.customize-classic-start-menu-dialog [data-action="cancel"]',
    )
    .click();
  expect(
    s.document.querySelector(".customize-classic-start-menu-dialog"),
  ).toBeNull();
});

test("stored Start menu options are validated", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        startMenuOptions: JSON.stringify({
          programCount: 99,
          largeIcons: "yes",
          items: { documents: "sideways" },
          programsClearedAt: -1,
        }),
      },
    }),
  );
  s.document.getElementById("start-button").click();
  expect(
    s.document.querySelectorAll("#start-menu-pinned .sm-game:not(.sm-pinned)"),
  ).toHaveLength(6);
  expect(placeIds(s)[0]).toBe("documents");
});

test("Start menu options cover hidden groups, file types, and menus", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        startMenuOptions: JSON.stringify({
          hoverOpen: false,
          listRecent: false,
          search: false,
          run: false,
          items: { controlPanel: "menu", pictures: "menu" },
        }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  fs.createFolder(fs.MY_PICTURES, "Beta");
  fs.createFolder(fs.MY_PICTURES, "Alpha");
  fs.createFile(fs.MY_PICTURES, "photo.bmp", { content: "" });
  fs.createFile(fs.MY_PICTURES, "notes.txt", { content: "" });
  s.document.getElementById("start-button").click();
  expect(placeIds(s)).toEqual([
    "documents",
    "pictures",
    "music",
    "computer",
    "controlPanel",
  ]);
  expect(
    s.document.querySelectorAll("#start-menu-places .sm-place-separator"),
  ).toHaveLength(1);

  s.document.querySelector('[data-start-action="pictures"]').click();
  const pictures = [
    ...s.document.querySelectorAll(".start-program-flyout button"),
  ];
  expect(
    pictures.map((button) => button.textContent.replace("▶", "").trim()),
  ).toEqual(["Alpha", "Beta", "Sample Pictures", "notes.txt", "photo.bmp"]);
  expect(pictures[3].querySelector("img").getAttribute("src")).toContain(
    "TextDocument.png",
  );
  expect(pictures[4].querySelector("img").getAttribute("src")).toContain(
    "BitmapImage.png",
  );
  pictures[0].dispatchEvent(new s.window.PointerEvent("pointerenter"));
  await s.advanceTime(300);
  expect(s.document.querySelectorAll(".start-program-flyout")).toHaveLength(1);

  s.document.querySelector('[data-start-action="controlPanel"]').click();
  [...s.document.querySelectorAll(".start-program-flyout button")]
    .find((button) => button.textContent.includes("Display"))
    .click();
  expect(
    s.document.querySelector('.xp-window[data-game="__display-properties"]'),
  ).not.toBeNull();
  s.document.getElementById("start-button").click();
  s.document.querySelector('[data-start-action="controlPanel"]').click();
  [...s.document.querySelectorAll(".start-program-flyout button")]
    .find((button) => button.textContent.includes("Taskbar"))
    .click();
  expect(s.document.querySelector(".taskbar-properties-dialog")).not.toBeNull();

  s.document.querySelector(".taskbar-start-customize").click();
  const dialog = s.document.querySelector(".customize-start-menu-dialog");
  expect(dialog.querySelector(".customize-search").checked).toBeFalse();
  expect(
    dialog.querySelector(".customize-list-recent input").checked,
  ).toBeFalse();
  dialog.querySelector(".customize-program-count input").value = "many";
  dialog.querySelector('[data-action="ok"]').click();
  expect(
    JSON.parse(s.window.localStorage.getItem("startMenuOptions")).programCount,
  ).toBe(6);

  const menu = s.document.getElementById("start-button-menu");
  rightClick(s, s.document.getElementById("start-button"));
  menu.dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  expect(menu.hidden).toBeFalse();
});

test("Classic expanded documents and pictures list their folders", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        startMenuStyle: "classic",
        startMenuOptions: JSON.stringify({
          classicExpand: { documents: true, pictures: true },
        }),
      },
    }),
  );
  s.document.getElementById("start-button").click();
  s.document.querySelectorAll("#start-menu-places .sm-place")[0].click();
  const folders = s.document.querySelectorAll(
    ".start-program-flyout .start-program-folder",
  );
  folders[0].click();
  expect(
    s.document.querySelectorAll(".start-program-flyout")[1].textContent,
  ).toContain("My Music");
  // My Pictures holds XP's Sample Pictures folder.
  folders[1].click();
  expect(
    s.document.querySelectorAll(".start-program-flyout")[1].textContent,
  ).toBe("Sample Pictures▶");
});
