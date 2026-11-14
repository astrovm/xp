// @ts-nocheck -- Happy DOM's element types intentionally replace lib.dom here.
import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

// The boot minimum starts once the boot bitmaps decode, which takes real
// event-loop turns before the virtual clock can be advanced meaningfully.
const waitForBootAnimation = async (shell) => {
  const boot = shell.document.getElementById("boot-screen");
  for (
    let turn = 0;
    turn < 100 && !boot.classList.contains("boot-running");
    turn++
  )
    await flushShell();
  expect(boot.classList.contains("boot-running")).toBeTrue();
};

describe("Windows XP shell", () => {
  test("waits for startup readiness and clears the boot framebuffer before Welcome", async () => {
    let releaseLibrary;
    const shell = await loadShell({
      gameLibraryManager: {
        subscribe: () => () => {},
        initialize: () =>
          new Promise((resolve) => {
            releaseLibrary = resolve;
          }),
      },
    });
    const boot = shell.document.getElementById("boot-screen")!;
    let clearedBeforeWelcome = false;
    const observer = new shell.window.MutationObserver(() => {
      if (boot.classList.contains("boot-handoff") && !boot.hidden) {
        clearedBeforeWelcome =
          shell.document.getElementById("welcome-screen")!.hidden;
      }
    });
    observer.observe(boot, { attributes: true });
    await waitForBootAnimation(shell);
    await shell.advanceTime(2100);
    expect(boot.classList.contains("boot-running")).toBeTrue();
    expect(boot.hidden).toBeFalse();
    // One complete progress pass has now elapsed, but storage is still loading.
    await shell.advanceTime(1800);
    expect(boot.hidden).toBeFalse();
    releaseLibrary({});
    // The handoff waits on storage promises and then several animation
    // frames; advance in small steps so a slow run cannot outpace it.
    for (let step = 0; step < 20 && !boot.hidden; step++)
      await shell.advanceTime(50);
    expect(clearedBeforeWelcome).toBeTrue();
    expect(boot.hidden).toBeTrue();
    expect(shell.document.getElementById("welcome-screen")!.hidden).toBeFalse();
    observer.disconnect();
  });

  test.each(["click", "Enter", " "])(
    "skips the boot screen with %s",
    async (input) => {
      const shell = await loadShell();
      const boot = shell.document.getElementById("boot-screen")!;
      expect(boot.hidden).toBeFalse();
      expect(boot.getAttribute("role")).toBe("button");
      expect(shell.document.activeElement).toBe(boot);
      if (input === "click") boot.click();
      else
        boot.dispatchEvent(
          new shell.window.KeyboardEvent("keydown", {
            key: input,
            bubbles: true,
          }),
        );
      await flushShell();
      expect(boot.hidden).toBeTrue();
      expect(
        shell.document.getElementById("welcome-screen")!.hidden,
      ).toBeFalse();
      shell.document.getElementById("welcome-screen")!.click();
      await flushShell();
      expect(shell.document.getElementById("desktop")!.hidden).toBeFalse();
    },
  );

  test("shows the boot fade and a complete progress pass even when startup is fast", async () => {
    const shell = await loadShell();
    const boot = shell.document.getElementById("boot-screen")!;
    await waitForBootAnimation(shell);
    await shell.advanceTime(2200);
    expect(boot.hidden).toBeFalse();
    await shell.advanceTime(1800);
    expect(boot.hidden).toBeTrue();
  });

  test("opens and closes the Start menu with working XP destinations", async () => {
    const shell = await login(await loadShell());
    const { document } = shell;
    const startButton = document.getElementById("start-button")!;
    const startMenu = document.getElementById("start-menu")!;

    startButton.click();
    expect(startMenu.hidden).toBeFalse();
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-start-action]")].map(
        (item) => item.dataset.startAction,
      ),
    ).toEqual([
      "documents",
      "recent",
      "pictures",
      "music",
      "computer",
      "controlPanel",
      "search",
      "run",
    ]);

    document.body.dispatchEvent(
      new shell.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(startMenu.hidden).toBeTrue();
    startButton.click();
    startButton.click();
    expect(startMenu.hidden).toBeTrue();

    const routes: Array<[string, string]> = [
      ["documents", "__my-documents"],
      ["pictures", "__my-pictures"],
      ["music", "__my-music"],
      ["computer", "__my-computer"],
      ["controlPanel", "__control-panel"],
      ["search", "__search"],
    ];
    for (const [action, windowId] of routes) {
      clickStartAction(shell, action);
      const opened = document.querySelector<HTMLElement>(
        `.xp-window[data-game="${windowId}"]`,
      );
      expect(opened).not.toBeNull();
      opened!.querySelector<HTMLButtonElement>(".close-btn")!.click();
    }
  });

  test("maximizes, restores, and closes a shell window from its caption buttons", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "documents");
    const win = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__my-documents"]',
    )!;
    const maximize = win.querySelector<HTMLButtonElement>(".maximize-btn")!;

    expect(maximize.getAttribute("aria-label")).toBe("Maximize");
    maximize.click();
    expect(win.classList.contains("maximized")).toBeTrue();
    expect(maximize.getAttribute("aria-label")).toBe("Restore");
    maximize.click();
    expect(win.classList.contains("maximized")).toBeFalse();
    expect(maximize.getAttribute("aria-label")).toBe("Maximize");

    win.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(win.isConnected).toBeFalse();
  });

  test("selects desktop icons and launches their actual destinations", async () => {
    const shell = await login(await loadShell());
    const settingsIcon = shell.document.querySelector<HTMLButtonElement>(
      '[data-desktop-id="__astro-settings"]',
    )!;

    settingsIcon.click();
    expect(settingsIcon.classList.contains("selected")).toBeTrue();
    settingsIcon.dispatchEvent(new shell.window.MouseEvent("dblclick"));
    const settings = shell.document.querySelector(
      '.xp-window[data-game="__astro-settings"] .project-settings-content',
    )!;
    expect(settings).not.toBeNull();
    expect(
      [...settings.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["General", "Games", "Updates", "Recovery"]);
    expect(settings.textContent).toContain("Offline games");
    expect(settings.textContent).toContain("Installed games");
    const updateDelay = settings.querySelector<HTMLInputElement>(
      '[data-project-setting="update-delay"]',
    )!;
    expect(updateDelay.type).toBe("range");
    expect(updateDelay.min).toBe("0");
    expect(updateDelay.max).toBe("72");
    expect(settings.textContent).not.toContain("Use release default");
    expect(
      settings.querySelector<HTMLInputElement>(
        '[data-project-setting="offline-enabled"]',
      )?.checked,
    ).toBeTrue();
    expect(
      settings.querySelector<HTMLInputElement>(
        '[data-project-setting="save-played-games"]',
      )?.checked,
    ).toBeTrue();
    expect(
      settings.querySelector<HTMLInputElement>(
        '[data-project-setting="automatic-updates"]',
      )?.checked,
    ).toBeTrue();
    expect(
      settings.querySelector('[data-project-action="update-now"]')?.textContent,
    ).toBe("Update Now");
  });

  test("moves between desktop icons by screen direction with arrow keys", async () => {
    const shell = await login(await loadShell());
    const ids = [
      "__my-computer",
      "__my-documents",
      "__internet-games",
      "__astro-settings",
    ];
    const icons = ids.map((id) =>
      shell.document.querySelector<HTMLButtonElement>(
        `[data-desktop-id="${id}"]`,
      ),
    );
    const positions = [
      [8, 8],
      [8, 88],
      [90, 8],
      [90, 88],
    ];
    icons.forEach((icon, index) => {
      const [left, top] = positions[index];
      icon!.getBoundingClientRect = () => ({
        left,
        top,
        right: left + 76,
        bottom: top + 74,
        width: 76,
        height: 74,
        x: left,
        y: top,
        toJSON: () => ({}),
      });
    });

    const press = (key: string) => {
      shell.document.dispatchEvent(
        new shell.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    };
    icons[0]!.click();
    icons[0]!.focus();

    press("ArrowRight");
    expect(shell.document.activeElement).toBe(icons[2]);
    press("ArrowDown");
    expect(shell.document.activeElement).toBe(icons[3]);
    press("ArrowLeft");
    expect(shell.document.activeElement).toBe(icons[1]);
    press("ArrowUp");
    expect(shell.document.activeElement).toBe(icons[0]);
    expect(icons[0]!.classList.contains("selected")).toBeTrue();
  });

  test("disables offline-dependent settings when offline access is off", async () => {
    const shell = await login(
      await loadShell({
        offlineSettings: { enabled: false, phase: "disabled" },
      }),
    );
    const settingsIcon = shell.document.querySelector<HTMLButtonElement>(
      '[data-desktop-id="__astro-settings"]',
    )!;
    settingsIcon.dispatchEvent(new shell.window.MouseEvent("dblclick"));
    const settings = shell.document.querySelector(
      '.xp-window[data-game="__astro-settings"] .project-settings-content',
    )!;
    expect(
      settings.querySelector<HTMLInputElement>(
        '[data-project-setting="offline-enabled"]',
      )?.checked,
    ).toBeFalse();
    for (const selector of [
      '[data-project-setting="save-played-games"]',
      '[data-project-setting="automatic-updates"]',
      '[data-project-setting="update-delay"]',
      '[data-project-action="check"]',
      '[data-project-action="update-now"]',
    ]) {
      expect(
        settings.querySelector<HTMLInputElement | HTMLButtonElement>(selector)
          ?.disabled,
      ).toBeTrue();
    }
  });

  test("prevents disabling offline access during a game download", async () => {
    const shell = await login(
      await loadShell({
        offlineSettings: { gamePhase: "downloading", activeGameId: "freecell" },
      }),
    );
    const settingsIcon = shell.document.querySelector<HTMLButtonElement>(
      '[data-desktop-id="__astro-settings"]',
    )!;
    settingsIcon.dispatchEvent(new shell.window.MouseEvent("dblclick"));
    expect(
      shell.document.querySelector<HTMLInputElement>(
        '.xp-window[data-game="__astro-settings"] [data-project-setting="offline-enabled"]',
      )?.disabled,
    ).toBeTrue();
  });

  test("shows the native My Computer shell menu and opens Properties", async () => {
    const shell = await login(await loadShell());
    const icon = shell.document.querySelector<HTMLButtonElement>(
      '[data-desktop-id="__my-computer"]',
    )!;
    icon.dispatchEvent(
      new shell.window.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 40,
        clientY: 30,
      }),
    );

    const menu = shell.document.getElementById("desktop-context-menu")!;
    expect(menu.hidden).toBeFalse();
    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>("[data-action]"),
    ];
    expect(items.map((item) => item.textContent!.trim())).toEqual([
      "Open",
      "Explore",
      "Search...",
      "Create Shortcut",
      "Delete",
      "Rename",
      "Properties",
    ]);
    expect(items.every((item) => !item.disabled)).toBeTrue();
    expect(items[0].classList.contains("context-default")).toBeTrue();

    menu
      .querySelector<HTMLButtonElement>('[data-action="computer-properties"]')!
      .click();
    expect(shell.document.querySelector(".xp-dialog")).not.toBeNull();
  });

  test("opens Control Panel applets and switches their tabs", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;

    expect(
      controlPanel.querySelector(
        '[data-control-panel-category="accessibility"]',
      ),
    ).toBeNull();
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="classic"]',
      )!
      .click();
    for (const action of [
      "users",
      "programs",
      "system",
      "accessibility-options",
      "mouse",
      "keyboard",
      "sounds-audio",
      "game-controllers",
      "view-printers",
      "help",
      "firewall",
      "power-options",
      "regional-language",
      "internet-options",
      "folder-options",
      "network-connections",
    ]) {
      expect(
        controlPanel.querySelector(`[data-control-panel-action="${action}"]`),
      ).toBeNull();
    }
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="classic"]',
      )!
      .click();

    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-category="appearance"]',
      )!
      .click();
    expect(controlPanel.querySelector("h1")!.textContent).toBe(
      "Pick a task...",
    );
    expect(
      controlPanel.querySelector(".control-panel-category-heading strong")!
        .textContent,
    ).toBe("Appearance and Themes");
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="display"]',
      )!
      .click();
    expect(
      shell.document.querySelector(".display-properties-content"),
    ).not.toBeNull();
  });

  test("applies and persists a wallpaper from Display Properties", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-category="appearance"]',
      )!
      .click();
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="display"]',
      )!
      .click();

    const display = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__display-properties"]',
    )!;
    display.querySelector<HTMLButtonElement>("#display-tab-desktop")!.click();
    display
      .querySelector<HTMLButtonElement>('[data-wallpaper="ascent"]')!
      .click();
    const apply = display.querySelector<HTMLButtonElement>(
      '[data-display-action="apply"]',
    )!;
    expect(apply.disabled).toBeFalse();
    apply.click();

    expect(
      JSON.parse(shell.window.localStorage.getItem("displaySettings")!)
        .wallpaper,
    ).toBe("ascent");
    expect(
      shell.document
        .getElementById("desktop")!
        .style.getPropertyValue("--desktop-background"),
    ).toContain('url("/assets/xp/wallpapers/ascent.jpg")');
    expect(
      shell.document
        .getElementById("desktop")!
        .style.getPropertyValue("--desktop-background"),
    ).toContain("ascent.jpg");
    expect(apply.disabled).toBeTrue();
  });

  test("renders 3D Pipes in the monitor and full-screen previews and cleans up", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-category="appearance"]',
      )!
      .click();
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="display"]',
      )!
      .click();

    const display = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__display-properties"]',
    )!;
    display.querySelector<HTMLButtonElement>("#display-tab-saver")!.click();
    const select = display.querySelector<HTMLSelectElement>("#display-saver")!;
    expect(select.value).toBe("pipes");
    expect([...select.options].map(({ value }) => value)).toEqual([
      "none",
      "pipes",
      "blank",
      "marquee",
      "stars",
      "windows-xp",
    ]);

    const monitor = display.querySelector<HTMLElement>(
      ".screen-saver-preview",
    )!;
    const monitorFrame = monitor.querySelector<HTMLIFrameElement>(
      ".pipes-screen-saver",
    )!;
    expect(monitorFrame).not.toBeNull();
    expect(monitorFrame.src).toEndWith(
      "/vendor/pipes/86e8eb1418f937ef43f9acbd871085c5160714fc/index.html",
    );

    display.querySelector<HTMLButtonElement>("#display-tab-desktop")!.click();
    expect(monitor.querySelector(".pipes-screen-saver")).toBeNull();
    display.querySelector<HTMLButtonElement>("#display-tab-saver")!.click();
    expect(monitor.querySelector(".pipes-screen-saver")).not.toBeNull();

    display
      .querySelector<HTMLButtonElement>(".display-saver-preview-button")!
      .click();
    const overlay = shell.document.getElementById("screen-saver-overlay")!;
    expect(overlay.hidden).toBeFalse();
    expect(overlay.querySelector(".pipes-screen-saver")).not.toBeNull();
    shell.document.dispatchEvent(
      new shell.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(overlay.hidden).toBeTrue();
    expect(overlay.querySelector(".pipes-screen-saver")).toBeNull();

    select.value = "stars";
    select.dispatchEvent(new shell.window.Event("change"));
    expect(monitor.querySelector(".pipes-screen-saver")).toBeNull();
    display.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(shell.document.querySelector(".pipes-screen-saver")).toBeNull();
  });

  test("migrates removed screen savers to 3D Pipes without resetting display settings", async () => {
    const shell = await login(
      await loadShell({
        initialStorage: {
          displaySettings: JSON.stringify({
            theme: "windows-xp",
            wallpaper: "ascent",
            customWallpaper: "",
            position: "stretch",
            backgroundColor: "#3a6ea5",
            appearance: "blue",
            fontSize: "normal",
            screenSaver: "flowerbox",
            screenSaverWait: 15,
            requireLoginOnResume: false,
            transitionEffect: "fade",
            fontSmoothing: "standard",
            largeIcons: false,
            menuShadows: true,
            showWindowContents: true,
            hideKeyboardCues: true,
            resolution: "auto",
          }),
        },
      }),
    );

    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-category="appearance"]',
      )!
      .click();
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="display"]',
      )!
      .click();
    const display = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__display-properties"]',
    )!;
    display.querySelector<HTMLButtonElement>("#display-tab-saver")!.click();

    expect(
      display.querySelector<HTMLSelectElement>("#display-saver")!.value,
    ).toBe("pipes");
    expect(
      display.querySelector<HTMLInputElement>("#display-saver-wait")!.value,
    ).toBe("15");
    expect(
      shell.document
        .getElementById("desktop")!
        .style.getPropertyValue("--desktop-background"),
    ).toContain("ascent.jpg");
  });

  test("ignores Control Panel clicks outside its actions", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;
    const windows = () => shell.document.querySelectorAll(".xp-window").length;
    const before = windows();
    const html = controlPanel.innerHTML;
    controlPanel.querySelector<HTMLElement>(".control-panel-main h1")!.click();
    await flushShell();
    expect(windows()).toBe(before);
    expect(controlPanel.innerHTML).toBe(html);
  });

  test("applies the native Windows Classic appearance and solid desktop", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "controlPanel");
    const controlPanel = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__control-panel"]',
    )!;
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-category="appearance"]',
      )!
      .click();
    controlPanel
      .querySelector<HTMLButtonElement>(
        '[data-control-panel-action="display"]',
      )!
      .click();

    const display = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__display-properties"]',
    )!;
    const theme = display.querySelector<HTMLSelectElement>("#display-theme")!;
    theme.value = "classic";
    theme.dispatchEvent(new shell.window.Event("change", { bubbles: true }));

    expect(
      display.querySelector<HTMLElement>(".display-theme-sample")!.dataset
        .schemePreview,
    ).toBe("classic");
    expect(
      display.querySelector<HTMLSelectElement>("#display-window-style")!.value,
    ).toBe("classic");
    expect(
      display.querySelector<HTMLSelectElement>("#display-appearance")!.value,
    ).toBe("classic");

    display
      .querySelector<HTMLButtonElement>('[data-display-action="apply"]')!
      .click();
    const saved = JSON.parse(
      shell.window.localStorage.getItem("displaySettings")!,
    );
    expect(saved).toMatchObject({
      theme: "classic",
      appearance: "classic",
      wallpaper: "none",
      backgroundColor: "#3a6ea5",
    });
    expect(shell.document.documentElement.dataset.xpAppearance).toBe("classic");
    expect(
      shell.document
        .getElementById("desktop")!
        .style.getPropertyValue("--desktop-background"),
    ).toBe("none");
  });

  test("runs a shell command from Run and closes the dialog after success", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "run");
    const runDialog = shell.document.querySelector<HTMLElement>(".run-dialog")!;
    const input = runDialog.querySelector<HTMLInputElement>("input")!;
    input.value = "control panel";
    input.dispatchEvent(new shell.window.Event("input", { bubbles: true }));
    runDialog.querySelector<HTMLButtonElement>('[data-action="run"]')!.click();
    await flushShell();

    expect(runDialog.isConnected).toBeFalse();
    expect(
      shell.document.querySelector('.xp-window[data-game="__control-panel"]'),
    ).not.toBeNull();
  });

  test("finds a virtual file with Search and opens it in Notepad", async () => {
    const shell = await login(await loadShell());
    const filesystem = (
      shell.window as unknown as {
        VirtualFS: {
          MY_DOCUMENTS: string;
          createFile(parent: string, name: string, options: object): unknown;
        };
      }
    ).VirtualFS;
    filesystem.createFile(filesystem.MY_DOCUMENTS, "notes.txt", {
      content: "hello",
    });
    clickStartAction(shell, "search");
    const search = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__search"]',
    )!;
    [...search.querySelectorAll<HTMLButtonElement>("[data-search-kind]")]
      .find((button) => button.textContent === "All files and folders")!
      .click();
    const name = search.querySelector<HTMLInputElement>("#search-filename")!;
    name.value = "notes";
    name.dispatchEvent(new shell.window.Event("input", { bubbles: true }));
    search
      .querySelector<HTMLButtonElement>('[data-search-action="search"]')!
      .click();
    await flushShell();

    const result = [...search.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent?.includes("notes.txt"),
    )!;
    expect(result).not.toBeNull();
    result.dispatchEvent(
      new shell.window.MouseEvent("dblclick", { bubbles: true }),
    );
    expect(
      shell.document.querySelector('.xp-window[data-game="__notepad"]'),
    ).not.toBeNull();
  });

  test("persists volume and mute state from the system tray", async () => {
    const shell = await login(await loadShell());
    const { document, window } = shell;
    document.getElementById("tray-volume-button")!.click();
    expect(document.getElementById("tray-volume-popup")!.hidden).toBeFalse();

    const slider = document.getElementById(
      "tray-volume-slider",
    ) as HTMLInputElement;
    slider.value = "35";
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(window.localStorage.getItem("volume")).toBe("35");
    expect(window.localStorage.getItem("isMuted")).toBe("false");

    const mute = document.getElementById(
      "tray-mute-checkbox",
    ) as HTMLInputElement;
    mute.checked = true;
    mute.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(window.localStorage.getItem("isMuted")).toBe("true");
    expect(document.getElementById("tray-volume-button")!.title).toBe(
      "Volume (muted)",
    );
    slider.value = "60";
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(window.localStorage.getItem("volume")).toBe("60");
    expect(window.localStorage.getItem("isMuted")).toBe("true");
  });

  test("scales game volume changes by the system volume", async () => {
    const shell = await login(
      await loadShell({ initialStorage: { volume: "40" } }),
    );
    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    const flyouts = shell.document.getElementById("start-menu-flyouts")!;
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="games"]')!
      .click();
    const adventure = [
      ...flyouts.querySelectorAll<HTMLButtonElement>(".start-program-folder"),
    ].find((button) => button.textContent?.trim().startsWith("Adventure"))!;
    adventure.click();
    const game = [
      ...flyouts.querySelectorAll<HTMLButtonElement>(".sm-game"),
    ].find((button) => button.textContent?.includes("Inside the Firewall"))!;
    game.click();
    await flushShell();

    const gameWindow = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="inside-the-firewall"]',
    )!;
    const iframe = gameWindow.querySelector<HTMLIFrameElement>("iframe")!;
    const appliedVolumes: number[] = [];
    iframe.contentWindow!.postMessage = ((message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "setVolume" &&
        "volume" in message &&
        typeof message.volume === "number"
      ) {
        appliedVolumes.push(message.volume);
      }
    }) as typeof iframe.contentWindow.postMessage;

    const gameVolume = gameWindow.querySelector<HTMLInputElement>(
      ".game-volume-slider",
    )!;
    gameVolume.value = "50";
    gameVolume.dispatchEvent(
      new shell.window.Event("input", { bubbles: true }),
    );
    expect(appliedVolumes.at(-1)).toBe(0.2);

    const mute = gameWindow.querySelector<HTMLButtonElement>(".volume-btn")!;
    mute.click();
    expect(appliedVolumes.at(-1)).toBe(0);
    mute.click();
    expect(appliedVolumes.at(-1)).toBe(0.2);
  });

  test("opens the clock dialog without a fabricated network status", async () => {
    const shell = await login(await loadShell());
    const clock = shell.document.getElementById("taskbar-clock")!;
    clock.click();
    expect(shell.document.querySelector(".datetime-dialog")).toBeNull();
    clock.dispatchEvent(new shell.window.MouseEvent("dblclick"));
    expect(shell.document.querySelector(".datetime-dialog")).not.toBeNull();

    expect(shell.document.getElementById("tray-network-button")).toBeNull();
  });

  test("draws the clock's second hand at any second of the minute", async () => {
    const shell = await login(await loadShell());
    shell.document
      .getElementById("taskbar-clock")!
      .dispatchEvent(new shell.window.MouseEvent("dblclick"));
    const dialog = shell.document.querySelector(".datetime-dialog")!;
    const time = dialog.querySelector<HTMLInputElement>(
      ".datetime-time-input",
    )!;

    // The hand is drawn from the wall clock, so its sloped steps are only
    // covered for some seconds. Walk the whole minute.
    for (let seconds = 0; seconds < 60; seconds++) {
      time.value = `10:09:${String(seconds).padStart(2, "0")} ${seconds < 12 ? "AM" : "PM"}`;
      time.dispatchEvent(new shell.window.Event("change", { bubbles: true }));
    }

    expect(dialog.querySelector(".datetime-time-input")).not.toBeNull();
  });

  test("lists system applications and games in the XP All Programs hierarchy", async () => {
    const shell = await login(await loadShell());
    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    const flyouts = shell.document.getElementById("start-menu-flyouts")!;
    expect(flyouts.hidden).toBeFalse();
    expect(
      [...flyouts.querySelectorAll<HTMLElement>("[data-program-id]")].map(
        (item) => item.dataset.programId,
      ),
    ).toEqual(["accessories", "games", "astro-settings", "internet-games"]);
    for (const programId of ["accessories", "games"]) {
      expect(
        flyouts
          .querySelector(`[data-program-id="${programId}"] img`)!
          .getAttribute("src"),
      ).toEndWith("/ProgramFolder.png");
    }

    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="accessories"]')!
      .click();
    const accessories = flyouts.querySelectorAll(".start-program-flyout")[1]!;
    const accessoryIds = [
      ...accessories.querySelectorAll<HTMLElement>("[data-program-id]"),
    ].map((item) => item.dataset.programId);
    for (const programId of [
      "entertainment",
      "calculator",
      "command-prompt",
      "notepad",
      "paint",
    ]) {
      expect(accessoryIds).toContain(programId);
    }
    const calculator = accessories.querySelector<HTMLButtonElement>(
      '[data-program-id="calculator"]',
    )!;
    calculator.click();
    const calculatorWindow = shell.document.querySelector(
      '.xp-window[data-game="__calculator"]',
    )!;
    // Calculator is web-native.
    expect(Boolean(calculatorWindow.querySelector(".xp-calculator"))).toBe(
      true,
    );
    expect(shell.document.querySelector("iframe")).toBeNull();

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="accessories"]')!
      .click();
    const notepad = flyouts.querySelector<HTMLButtonElement>(
      '[data-program-id="notepad"]',
    )!;
    expect(notepad).not.toBeNull();
    expect(notepad.querySelector("img")!.getAttribute("src")).toEndWith(
      "/Notepad.png",
    );
    notepad.click();
    expect(shell.document.querySelector(".notepad-window")).not.toBeNull();

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="games"]')!
      .click();
    const minesweeper = flyouts.querySelector<HTMLButtonElement>(
      '[data-program-id="minesweeper"]',
    )!;
    expect(minesweeper.querySelector("img")!.getAttribute("src")).toEndWith(
      "/Minesweeper.png",
    );
    minesweeper.click();
    const minesweeperWindow = shell.document.querySelector(
      '.xp-window[data-game="__minesweeper"]',
    )!;
    expect(
      minesweeperWindow.querySelector<HTMLButtonElement>(".maximize-btn")!
        .disabled,
    ).toBeTrue();
    expect(minesweeperWindow.querySelector(".resize-handle")).toBeNull();
    const mineCells = minesweeperWindow.querySelectorAll<HTMLButtonElement>(
      ".xp-minesweeper-board [role='gridcell']",
    );
    expect(mineCells).toHaveLength(81);
    mineCells[40]!.click();
    expect(mineCells[40]!.dataset.open).toBe("true");
    minesweeperWindow
      .querySelector<HTMLButtonElement>(".minesweeper-menu-trigger")!
      .click();
    minesweeperWindow
      .querySelector<HTMLButtonElement>('[data-command="intermediate"]')!
      .click();
    const intermediateCells =
      minesweeperWindow.querySelectorAll<HTMLButtonElement>(
        ".xp-minesweeper-board [role='gridcell']",
      );
    expect(intermediateCells).toHaveLength(256);
    intermediateCells[128]!.click();
    expect(intermediateCells[128]!.dataset.open).toBe("true");
    minesweeperWindow
      .querySelector<HTMLButtonElement>(".minesweeper-menu-trigger")!
      .click();
    minesweeperWindow
      .querySelector<HTMLButtonElement>('[data-command="expert"]')!
      .click();
    expect(
      minesweeperWindow.querySelectorAll<HTMLButtonElement>(
        ".xp-minesweeper-board [role='gridcell']",
      ),
    ).toHaveLength(480);
    expect((minesweeperWindow as HTMLElement).style.width).toBe("506px");
    expect((minesweeperWindow as HTMLElement).style.height).toBe("377px");
    minesweeperWindow
      .querySelector<HTMLButtonElement>(".minesweeper-menu-trigger")!
      .click();
    minesweeperWindow
      .querySelector<HTMLButtonElement>('[data-command="sound"]')!
      .click();
    expect(
      JSON.parse(shell.window.localStorage.getItem("minesweeperSettings")!),
    ).toEqual({
      difficulty: "expert",
      customLevel: { rows: 20, columns: 20, mines: 80 },
      marks: true,
      color: true,
      sound: false,
    });
    minesweeperWindow.querySelector<HTMLButtonElement>(".close-btn")!.click();

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="games"]')!
      .click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="minesweeper"]')!
      .click();
    const restoredMinesweeper = shell.document.querySelector(
      '.xp-window[data-game="__minesweeper"]',
    )!;
    expect(
      restoredMinesweeper.querySelectorAll(
        ".xp-minesweeper-board [role='gridcell']",
      ),
    ).toHaveLength(480);
    restoredMinesweeper
      .querySelector<HTMLButtonElement>(".minesweeper-menu-trigger")!
      .click();
    expect(
      restoredMinesweeper.querySelector<HTMLElement>(
        '[data-command="expert"] [data-check]',
      )!.textContent,
    ).toBe("✓");
    expect(
      restoredMinesweeper.querySelector<HTMLElement>(
        '[data-command="sound"] [data-check]',
      )!.textContent,
    ).toBe("");
    restoredMinesweeper.querySelector<HTMLButtonElement>(".close-btn")!.click();

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="games"]')!
      .click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="solitaire"]')!
      .click();
    const solitaireWindow = shell.document.querySelector(
      '.xp-window[data-game="__solitaire"]',
    )!;
    expect(solitaireWindow.querySelector(".solitaire-board")).not.toBeNull();
    expect(shell.document.querySelector("iframe")).toBeNull();

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="games"]')!
      .click();
    const adventure = [
      ...flyouts.querySelectorAll<HTMLButtonElement>(".start-program-folder"),
    ].find((button) => button.textContent?.trim().startsWith("Adventure"));
    expect(adventure).not.toBeNull();
    expect(adventure!.querySelector("img")!.getAttribute("src")).toEndWith(
      "/ProgramFolder.png",
    );
    adventure!.click();
    const game = [
      ...flyouts.querySelectorAll<HTMLButtonElement>(".sm-game"),
    ].find((button) => button.textContent?.includes("Inside the Firewall"));
    expect(game).not.toBeNull();
    expect(game!.querySelector("img")!.getAttribute("src")).toContain(
      "inside-the-firewall",
    );
    game!.click();
    await flushShell();
    expect(
      shell.document.querySelector(
        '.xp-window[data-game="inside-the-firewall"] iframe',
      ),
    ).not.toBeNull();
  });

  test("opens Command Prompt in the XP console layout on the shared filesystem", async () => {
    const shell = await login(await loadShell());
    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    const flyouts = shell.document.getElementById("start-menu-flyouts")!;
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="accessories"]')!
      .click();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="command-prompt"]')!
      .click();

    const commandWindow = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__command-prompt"]',
    )!;
    const input = commandWindow.querySelector<HTMLInputElement>(
      ".xp-terminal-prompt input",
    )!;
    const output = commandWindow.querySelector<HTMLElement>(
      ".xp-terminal-output",
    )!;
    const prompt = commandWindow.querySelector<HTMLElement>(
      ".xp-terminal-prompt span",
    )!;
    const run = async (command: string) => {
      input.value = command;
      input.dispatchEvent(
        new shell.window.KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
        }),
      );
      await flushShell();
    };

    expect(commandWindow.style.width).toBe("668px");
    expect(commandWindow.style.height).toBe("338px");
    expect(commandWindow.style.left).toBe("24px");
    expect(commandWindow.style.top).toBe("30px");
    expect(
      commandWindow.querySelector<HTMLButtonElement>(".maximize-btn")!.disabled,
    ).toBeFalse();
    expect(commandWindow.querySelector(".resize-handle")).not.toBeNull();
    expect(commandWindow.querySelector(".title-text")!.textContent).toBe(
      "C:\\WINDOWS\\system32\\cmd.exe",
    );
    expect(output.textContent).toStartWith(
      "Microsoft Windows XP [Version 5.1.2600]",
    );
    // Like XP, the prompt starts in the profile of the user, astro.
    expect(prompt.textContent).toBe("C:\\Documents and Settings\\astro>");

    commandWindow
      .querySelector<HTMLElement>(".title-bar")!
      .dispatchEvent(
        new shell.window.PointerEvent("pointerdown", { bubbles: true }),
      );
    await flushShell();
    expect(shell.document.activeElement).toBe(input);

    commandWindow.querySelector<HTMLButtonElement>(".maximize-btn")!.click();
    expect(commandWindow.classList.contains("maximized")).toBeTrue();
    commandWindow.querySelector<HTMLButtonElement>(".maximize-btn")!.click();

    await run('cd "My Documents"');
    expect(prompt.textContent).toBe(
      "C:\\Documents and Settings\\astro\\My Documents>",
    );
    await run("echo Hello XP>note.txt");
    const note = shell.window.VirtualFS.findChild(
      shell.window.VirtualFS.MY_DOCUMENTS,
      "note.txt",
    );
    expect(note).not.toBeNull();
    expect(shell.window.VirtualFS.getContent(note.id)).toBe("Hello XP\n");

    await run("type note.txt");
    expect(output.textContent).toContain("Hello XP");
    await run("notepad note.txt");
    expect(
      shell.document.querySelector('.xp-window[data-game="__notepad"]'),
    ).not.toBeNull();
    await run("del note.txt");
    expect(shell.window.VirtualFS.getNode(note.id)).toBeNull();
  });

  test("opens native games from their public deep links", async () => {
    for (const [deepLink, applicationId] of [
      ["freecell", "__freecell"],
      ["hearts", "__hearts"],
      ["minesweeper", "__minesweeper"],
      ["pinball", "__pinball"],
      ["solitaire", "__solitaire"],
      ["spider-solitaire", "__spider-solitaire"],
    ]) {
      const shell = await loadShell();
      shell.window.location.hash = `#${deepLink}`;
      await login(shell);
      expect(
        shell.document.querySelector(
          `.xp-window[data-game="${applicationId}"]`,
        ),
      ).not.toBeNull();
    }
  });

  test("ignores deep links that only match built-in object properties", async () => {
    const shell = await loadShell();
    shell.window.location.hash = "#constructor";
    await login(shell);
    await flushShell();
    expect(shell.document.querySelector(".xp-window")).toBeNull();
  });

  test("does not save played built-in games when automatic offline copies are disabled", async () => {
    const shell = await loadShell({
      offlineSettings: { savePlayedGamesOffline: false },
    });
    shell.window.location.hash = "#inside-the-firewall";
    await login(shell);
    await flushShell();
    expect(shell.offlineDownloads).toEqual([]);
  });

  test("does not download a played built-in game that is already saved offline", async () => {
    const shell = await loadShell({
      offlineSettings: { downloadedGameIds: ["inside-the-firewall"] },
    });
    shell.window.location.hash = "#inside-the-firewall";
    await login(shell);
    await flushShell();
    await flushShell();
    expect(
      shell.document.querySelector('[data-game="inside-the-firewall"]'),
    ).not.toBeNull();
    expect(shell.offlineDownloads).toEqual([]);
  });

  test("opens an installed-game deep link after the library becomes ready", async () => {
    let releaseLibrary;
    const gameLibraryManager = {
      subscribe: () => () => {},
      initialize: () =>
        new Promise((resolve) => {
          releaseLibrary = resolve;
        }),
      search: async () => [],
      details: async () => null,
      install: async () => {},
      uninstall: async () => {},
      getRecord: () => null,
      match: async () => null,
    };
    const shell = await loadShell({ gameLibraryManager });
    shell.window.location.hash = "#delayed-installed-game";
    await login(shell);
    expect(
      shell.document.querySelector('[data-game="delayed-installed-game"]'),
    ).toBeNull();

    releaseLibrary({
      "delayed-installed-game": {
        ...shell.window.FLASH_GAMES["bike-mania"],
        id: "delayed-installed-game",
        title: "Delayed Installed Game",
      },
    });
    await flushShell();
    await flushShell();

    expect(
      shell.document.querySelector(
        '.xp-window[data-game="delayed-installed-game"]',
      ),
    ).not.toBeNull();
  });

  test("reports a played built-in game that can't be saved for offline play", async () => {
    const shell = await loadShell({
      offlineMethods: {
        async downloadGame() {
          throw new Error("quota");
        },
      },
    });
    const warnings: unknown[][] = [];
    shell.window.console.warn = (...args: unknown[]) => warnings.push(args);
    shell.window.location.hash = "#inside-the-firewall";
    await login(shell);
    await flushShell();
    await flushShell();
    expect(
      warnings.find(([message]) =>
        String(message).startsWith("Could not save game"),
      ),
    ).toEqual([
      "Could not save game for offline play:",
      "Inside the Firewall",
      expect.any(Error),
    ]);
  });

  test("resolves bundled iframe deep links against the production release base URL", async () => {
    const shell = await loadShell();
    const version = "26.08.12-abcdef1";
    const gameRoot = "iframe/inside-the-firewall.0123456789abcdef/";
    const base = shell.document.createElement("base");
    base.href = `/releases/${version}/`;
    shell.document.head.prepend(base);
    shell.window.ASTRO_GAME_ROOTS = {
      "inside-the-firewall": gameRoot,
    };
    shell.window.location.hash = "#inside-the-firewall";

    await login(shell);

    const frame = shell.document.querySelector<HTMLIFrameElement>(
      '.xp-window[data-game="inside-the-firewall"] iframe',
    );
    expect(frame?.src).toBe(`http://127.0.0.1/releases/${version}/${gameRoot}`);
  });

  test("neither installs nor exposes placeholder-only applications", async () => {
    const shell = await login(await loadShell());
    const removedApplicationIds = [
      "__user-accounts",
      "__add-remove-programs",
      "__printers",
      "__help",
      "__winamp",
      "__security-center",
      "__accessibility-wizard",
      "__magnifier",
      "__narrator",
      "__utility-manager",
      "__program-compatibility-wizard",
      "__synchronize",
      "__tour-windows-xp",
      "__network-connections",
      "__network-setup-wizard",
      "__new-connection-wizard",
      "__wireless-network-setup-wizard",
      "__remote-assistance",
      "__internet-backgammon",
      "__internet-checkers",
      "__internet-hearts",
      "__internet-reversi",
      "__internet-spades",
      "__windows-catalog",
      "__windows-update",
      "__backup",
      "__files-settings-transfer",
      "__system-restore",
      "__windows-movie-maker",
      "__on-screen-keyboard",
      "__character-map",
      "__remote-desktop",
      "__hyperterminal",
      "__internet-explorer",
      "__msn",
      "__outlook-express",
      "__windows-messenger",
      "__program-access-defaults",
      "__sound-recorder",
      "__windows-media-player",
      "__disk-cleanup",
      "__disk-defragmenter",
      "__scheduled-tasks",
      "__system-information",
      "__address-book",
    ];

    for (const applicationId of removedApplicationIds) {
      expect(shell.window.XPApplicationRegistry.has(applicationId)).toBeFalse();
      expect(
        shell.document.querySelector(
          `.desktop-icon[data-system-id="${applicationId}"]`,
        ),
      ).toBeNull();
    }

    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    const flyouts = shell.document.getElementById("start-menu-flyouts")!;
    for (const folder of [
      "accessories",
      "accessibility",
      "communications",
      "games",
    ]) {
      flyouts
        .querySelector<HTMLButtonElement>(`[data-program-id="${folder}"]`)
        ?.click();
    }
    const exposedIds = [
      ...flyouts.querySelectorAll<HTMLElement>("[data-program-id]"),
    ].map((item) => item.dataset.programId);
    for (const applicationId of removedApplicationIds) {
      expect(exposedIds).not.toContain(applicationId.slice(2));
    }
  });

  test("mounts Paint natively with its supported picture file associations", async () => {
    const shell = await login(await loadShell());
    const picture = shell.window.VirtualFS.createFile(
      shell.window.VirtualFS.MY_PICTURES,
      "sample.png",
      { content: "data:image/png;base64,iVBORw0KGgo=" },
    );

    expect(shell.window.VirtualFS.open(picture.id)).toBeTrue();
    const paintWindow = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__paint"]',
    )!;
    expect(paintWindow).not.toBeNull();
    expect(paintWindow.querySelector("iframe")).toBeNull();
    expect(paintWindow.querySelector(".paint-menu-bar")).not.toBeNull();
    expect(paintWindow.querySelector(".paint-toolbox")).not.toBeNull();
    expect(paintWindow.querySelector("canvas.paint-canvas")).not.toBeNull();
    expect(paintWindow.querySelectorAll(".paint-scrollbar")).toHaveLength(2);
    expect(
      paintWindow.querySelector<HTMLButtonElement>(".paint-tool.selected")!
        .dataset.tool,
    ).toBe("rect-select");
    expect(paintWindow.querySelectorAll(".paint-status span")).toHaveLength(3);
    expect(paintWindow.classList.contains("xp-native-paint-window")).toBeTrue();
    expect(paintWindow.style.width).toBe("760px");
    expect(paintWindow.style.height).toBe("560px");
    expect(paintWindow.style.left).toBe("0px");
    expect(paintWindow.style.top).toBe("0px");

    const menuButton = (label: string) =>
      [
        ...paintWindow.querySelectorAll<HTMLButtonElement>(
          ".paint-menu-group > button",
        ),
      ].find((button) => button.textContent === label)!;
    menuButton("File").click();
    for (const command of [
      "scanner",
      "print-preview",
      "page-setup",
      "print",
      "send",
    ]) {
      expect(
        paintWindow.querySelector(`[data-paint-command="${command}"]`),
      ).toBeNull();
    }
    expect(
      paintWindow.querySelector('[data-paint-command="wallpaper-tiled"]'),
    ).not.toBeNull();
    paintWindow
      .querySelector<HTMLButtonElement>('[data-paint-command="open"]')!
      .click();
    await flushShell();
    const openDialog = shell.document.querySelector<HTMLElement>(
      '.xp-dialog[aria-label="Open"]',
    )!;
    expect(
      [...openDialog.querySelectorAll<HTMLElement>(".dlg-file-item")].some(
        (item) => item.textContent?.trim().endsWith("sample.png"),
      ),
    ).toBeTrue();
    openDialog
      .querySelectorAll<HTMLButtonElement>(".dlg-buttons button")[1]
      .click();
    menuButton("File").click();
    paintWindow
      .querySelector<HTMLButtonElement>('[data-paint-command="new"]')!
      .click();
    await flushShell();

    menuButton("Colors").click();
    paintWindow
      .querySelector<HTMLButtonElement>('[data-paint-command="edit-colors"]')!
      .click();
    const editColors = shell.document.querySelector<HTMLElement>(
      ".paint-edit-colors-dialog",
    )!;
    expect(editColors.querySelector(".help-btn")).not.toBeNull();
    expect(
      editColors.querySelectorAll(".paint-edit-color-grid button"),
    ).toHaveLength(48);
    editColors
      .querySelectorAll<HTMLButtonElement>(".dlg-buttons button")[1]
      .click();

    menuButton("Image").click();
    paintWindow
      .querySelector<HTMLButtonElement>('[data-paint-command="attributes"]')!
      .click();
    const attributes = shell.document.querySelector<HTMLElement>(
      ".paint-attributes-dialog",
    )!;
    expect(
      attributes.querySelector<HTMLInputElement>('[name="width"]')!.value,
    ).toBe("516");
    attributes
      .querySelectorAll<HTMLButtonElement>(".dlg-buttons button")[1]
      .click();

    menuButton("Help").click();
    paintWindow
      .querySelector<HTMLButtonElement>('[data-paint-command="about"]')!
      .click();
    const aboutPaint = shell.document.querySelector<HTMLElement>(
      '.xp-about-dialog[aria-label="About Paint"]',
    )!;
    expect(aboutPaint).not.toBeNull();
    expect(aboutPaint.querySelector(".xp-about-banner")).not.toBeNull();
    aboutPaint.querySelector<HTMLButtonElement>(".dlg-buttons button")!.click();
    expect(
      shell.document.querySelector(
        '.xp-about-dialog[aria-label="About Paint"]',
      ),
    ).toBeNull();

    Object.assign(paintWindow.style, {
      width: "700px",
      height: "520px",
      left: "96px",
      top: "72px",
    });
    paintWindow.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(shell.window.VirtualFS.open(picture.id)).toBeTrue();
    const reopenedPaint = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__paint"]',
    )!;
    expect(reopenedPaint.style.width).toBe("700px");
    expect(reopenedPaint.style.height).toBe("520px");
    expect(reopenedPaint.style.left).toBe("96px");
    expect(reopenedPaint.style.top).toBe("72px");
  });

  test("changes the shell volume from Volume Control", async () => {
    const shell = await login(await loadShell());
    const openEntertainment = () => {
      shell.document.getElementById("start-button")!.click();
      shell.document.getElementById("all-programs-button")!.click();
      const flyouts = shell.document.getElementById("start-menu-flyouts")!;
      flyouts
        .querySelector<HTMLButtonElement>('[data-program-id="accessories"]')!
        .click();
      flyouts
        .querySelector<HTMLButtonElement>('[data-program-id="entertainment"]')!
        .click();
      return flyouts;
    };

    const flyouts = openEntertainment();
    flyouts
      .querySelector<HTMLButtonElement>('[data-program-id="volume-control"]')!
      .click();
    const volume = shell.document.querySelector<HTMLInputElement>(
      '.xp-window[data-game="__volume-control"] .xp-mixer-volume',
    )!;
    volume.value = "35";
    volume.dispatchEvent(new shell.window.Event("input", { bubbles: true }));
    expect(shell.window.localStorage.getItem("volume")).toBe("35");
  });

  test("opens Volume Control muted when the system is muted and unmutes it", async () => {
    const shell = await login(
      await loadShell({ initialStorage: { volume: "40", isMuted: "true" } }),
    );
    shell.document.getElementById("start-button")!.click();
    shell.document.getElementById("all-programs-button")!.click();
    const flyouts = shell.document.getElementById("start-menu-flyouts")!;
    for (const id of ["accessories", "entertainment", "volume-control"])
      flyouts
        .querySelector<HTMLButtonElement>(`[data-program-id="${id}"]`)!
        .click();
    const win = shell.document.querySelector(
      '.xp-window[data-game="__volume-control"]',
    )!;
    const mute = win.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(mute.checked).toBeTrue();
    expect(win.querySelector<HTMLInputElement>(".xp-mixer-volume")!.value).toBe(
      "40",
    );
    mute.checked = false;
    mute.dispatchEvent(new shell.window.Event("change", { bubbles: true }));
    expect(shell.window.localStorage.getItem("isMuted")).toBe("false");
    expect(shell.document.getElementById("tray-volume-button")!.title).toBe(
      "Volume",
    );
  });

  test("applies the Classic Start menu from Taskbar Properties independently and switches previews", async () => {
    const shell = await login(await loadShell());
    const { document, window } = shell;
    document.getElementById("taskbar")!.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 400,
        clientY: 740,
      }),
    );
    document
      .querySelector<HTMLButtonElement>('[data-taskbar-action="properties"]')!
      .click();
    const dialog = document.querySelector<HTMLElement>(
      ".taskbar-properties-dialog",
    )!;
    dialog
      .querySelector<HTMLButtonElement>(
        '[data-taskbar-properties-tab="start-menu"]',
      )!
      .click();

    const preview = dialog.querySelector<HTMLImageElement>(
      ".taskbar-start-menu-preview",
    )!;
    expect(preview.src).toEndWith("/assets/xp/system/StartMenuPreview.png");
    const classic = dialog.querySelector<HTMLInputElement>(
      '[name="taskbar-start-menu-style"][value="classic"]',
    )!;
    classic.click();
    expect(preview.src).toEndWith(
      "/assets/xp/system/ClassicStartMenuPreview.png",
    );
    expect(
      dialog.querySelector<HTMLButtonElement>(".taskbar-start-customize")!
        .disabled,
    ).toBeTrue();
    expect(
      dialog.querySelector<HTMLButtonElement>(".taskbar-classic-customize")!
        .disabled,
    ).toBeFalse();
    dialog
      .querySelector<HTMLButtonElement>(
        '.taskbar-properties-buttons [data-action="ok"]',
      )!
      .click();

    expect(window.localStorage.getItem("startMenuStyle")).toBe("classic");
    expect(document.documentElement.dataset.xpStartMenu).toBe("classic");
    expect(document.documentElement.dataset.xpAppearance).toBe("blue");
    document.getElementById("start-button")!.click();
    expect(document.querySelector(".start-menu-user")!.textContent).toBe(
      "Windows XP Professional",
    );
    expect(
      document.querySelector("#all-programs-button > .all-programs-label")!
        .textContent,
    ).toBe("Programs");
    expect(document.getElementById("log-off-button")!.textContent).toContain(
      "Log Off astro...",
    );

    document.documentElement.dataset.xpAppearance = "classic";
    expect(document.documentElement.dataset.xpStartMenu).toBe("classic");
  });

  test("shows personal-settings progress after logon until storage is ready", async () => {
    const shell = await login(await loadShell());
    shell.document.getElementById("logoff-confirm")!.click();
    await flushShell();
    let ready;
    Object.defineProperty(shell.window.VirtualFS, "ready", {
      value: new Promise((resolve) => {
        ready = resolve;
      }),
    });
    const screen = shell.document.getElementById("welcome-screen")!;
    const tile = shell.document.getElementById("login-user")!;
    tile.click();
    expect(screen.classList.contains("logging-in")).toBeTrue();
    expect(screen.getAttribute("aria-busy")).toBe("true");
    expect(tile.disabled).toBeTrue();
    expect(
      shell.document.getElementById("welcome-user-status")!.textContent,
    ).toBe("Loading your personal settings...");
    expect(shell.document.getElementById("desktop")!.hidden).toBeTrue();
    ready();
    await flushShell();
    expect(shell.document.getElementById("desktop")!.hidden).toBeFalse();
    expect(tile.disabled).toBeFalse();
    expect(screen.hasAttribute("aria-busy")).toBeFalse();
  });

  test("requires the user tile to log on and restores a switched session", async () => {
    const shell = await login(await loadShell());
    const { document } = shell;
    clickStartAction(shell, "documents");
    const explorer = document.querySelector(
      '.xp-window[data-game="__my-documents"]',
    );
    document.getElementById("switch-user-confirm")!.click();
    expect(document.getElementById("welcome-screen")!.hidden).toBeFalse();
    expect(document.getElementById("welcome-user-status")!.hidden).toBeFalse();
    expect(document.getElementById("welcome-user-status")!.textContent).toBe(
      "1 program running.",
    );
    document.getElementById("welcome-user-status")!.click();
    await flushShell();
    expect(document.getElementById("desktop")!.hidden).toBeTrue();
    document.getElementById("welcome-screen")!.click();
    await flushShell();
    expect(document.getElementById("desktop")!.hidden).toBeTrue();
    document.getElementById("welcome-turn-off")!.click();
    expect(document.getElementById("shutdown-dialog")!.hidden).toBeFalse();
    document.getElementById("shutdown-cancel")!.click();
    expect(document.getElementById("welcome-screen")!.hidden).toBeFalse();
    document.getElementById("login-user")!.click();
    await flushShell();
    expect(document.getElementById("desktop")!.hidden).toBeFalse();
    expect(
      document.querySelector('.xp-window[data-game="__my-documents"]'),
    ).toBe(explorer);
  });

  test("changes the visible session screen for logoff and shutdown actions", async () => {
    const shell = await login(await loadShell());
    const { document } = shell;

    document.getElementById("start-button")!.click();
    document.getElementById("log-off-button")!.click();
    expect(document.getElementById("logoff-dialog")!.hidden).toBeFalse();
    document.getElementById("logoff-confirm")!.click();
    await flushShell();
    expect(document.getElementById("welcome-screen")!.hidden).toBeFalse();
    expect(document.getElementById("welcome-user-status")!.hidden).toBeTrue();
    document.getElementById("welcome-screen")!.click();
    await flushShell();
    expect(document.getElementById("desktop")!.hidden).toBeTrue();

    document.getElementById("login-user")!.click();
    await flushShell();
    document.getElementById("start-button")!.click();
    document.getElementById("turn-off-button")!.click();
    expect(document.getElementById("shutdown-dialog")!.hidden).toBeFalse();
    document.getElementById("standby-confirm")!.click();
    expect(document.getElementById("standby-screen")!.hidden).toBeFalse();
    document.getElementById("standby-resume")!.click();
    expect(document.getElementById("standby-screen")!.hidden).toBeTrue();
  });

  test("lists real applications in Task Manager and ends them", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "documents");
    shell.document
      .querySelector<HTMLButtonElement>('[data-taskbar-action="task-manager"]')!
      .click();
    await flushShell();
    const manager = shell.document.querySelector<HTMLElement>(
      '.xp-window[data-game="__task-manager"]',
    )!;
    expect(
      [...manager.querySelectorAll<HTMLElement>("[data-tm-tab]")].map(
        (tab) => tab.dataset.tmTab,
      ),
    ).toEqual([
      "applications",
      "processes",
      "performance",
      "networking",
      "users",
    ]);
    expect(
      manager.querySelector('.tm-tasks [data-tm-id="__my-documents"]'),
    ).not.toBeNull();
    manager
      .querySelector<HTMLButtonElement>('[data-tm-command="end-task"]')!
      .click();
    await flushShell();
    await flushShell();
    expect(
      shell.document.querySelector('.xp-window[data-game="__my-documents"]'),
    ).toBeNull();
    expect(
      manager.querySelector('.tm-tasks [data-tm-id="__my-documents"]'),
    ).toBeNull();
  });

  test("plays one startup sound and keeps XP sounds for manual session transitions", async () => {
    const shell = await loadShell();
    const sounds = [];
    shell.window.Audio = function Audio(path) {
      sounds.push(path);
      return { volume: 1, pause: () => {}, play: () => Promise.resolve() };
    };
    await login(shell);
    expect(sounds).toEqual(["assets/xp/sounds/startup.wav"]);
    const { document } = shell;
    document.getElementById("log-off-button").click();
    document.getElementById("switch-user-confirm").click();
    document.getElementById("login-user").click();
    await flushShell();
    expect(sounds).toEqual([
      "assets/xp/sounds/startup.wav",
      "assets/xp/sounds/logoff.wav",
      "assets/xp/sounds/logon.wav",
    ]);
    document.getElementById("log-off-button").click();
    document.getElementById("logoff-confirm").click();
    await flushShell();
    expect(sounds.at(-1)).toBe("assets/xp/sounds/shutdown.wav");
    document.getElementById("login-user").click();
    await flushShell();
    expect(sounds).toEqual([
      "assets/xp/sounds/startup.wav",
      "assets/xp/sounds/logoff.wav",
      "assets/xp/sounds/logon.wav",
      "assets/xp/sounds/shutdown.wav",
      "assets/xp/sounds/startup.wav",
    ]);
  });

  test("counts open windows as running programs on a switched session", async () => {
    const shell = await login(await loadShell());
    clickStartAction(shell, "documents");
    clickStartAction(shell, "computer");
    shell.document.getElementById("switch-user-confirm").click();
    const status = shell.document.getElementById("welcome-user-status");
    expect(status.textContent).toBe("2 programs running.");
  });

  test("retries autoplay-blocked startup audio on a Welcome gesture", async () => {
    const shell = await loadShell();
    const attempts = [];
    const elements = [];
    shell.window.Audio = function Audio(path) {
      const element = {
        volume: 1,
        pause: () => {},
        play: () => {
          attempts.push(path);
          return attempts.length === 1
            ? Promise.reject(new Error("NotAllowedError"))
            : Promise.resolve();
        },
      };
      elements.push(element);
      return element;
    };
    shell.completeBoot();
    await flushShell();
    shell.document.getElementById("welcome-screen").click();
    await flushShell();
    expect(attempts).toEqual([
      "assets/xp/sounds/startup.wav",
      "assets/xp/sounds/startup.wav",
    ]);
    expect(elements).toHaveLength(1);
    expect(shell.document.getElementById("desktop").hidden).toBeFalse();
  });

  test.each(["checking", "updating", "applying"])(
    "shows the active %s update stage in Settings with automatic downloads disabled",
    async (phase) => {
      const shell = await login(
        await loadShell({
          offlineSettings: { phase, automaticUpdatesEnabled: false },
        }),
      );
      shell.document
        .querySelector('[data-desktop-id="__astro-settings"]')
        ?.dispatchEvent(
          new shell.window.MouseEvent("dblclick", { bubbles: true }),
        );
      const settings = shell.document.querySelector(
        ".project-settings-content",
      );
      expect(settings).not.toBeNull();
      expect(
        settings.querySelector("[data-project-update-progress]").hidden,
      ).toBeFalse();
      expect(
        settings.querySelector('[data-project-action="update-now"]').disabled,
      ).toBeTrue();
      expect(
        settings.querySelector('[data-project-status="updates"]').textContent,
      ).toContain(
        phase === "checking"
          ? "Checking"
          : phase === "updating"
            ? "Downloading"
            : "Restarting",
      );
    },
  );

  test("ignores repeated startup gestures without restarting boot or replaying the sound", async () => {
    const shell = await loadShell();
    const sounds = [];
    shell.window.Audio = function Audio(path) {
      sounds.push(path);
      return { volume: 1, pause: () => {}, play: () => Promise.resolve() };
    };
    for (let i = 0; i < 8; i++) {
      shell.document.getElementById("boot-screen").click();
      shell.document.getElementById("welcome-screen").click();
      await flushShell();
    }
    expect(sounds).toEqual(["assets/xp/sounds/startup.wav"]);
    expect(shell.document.getElementById("desktop").hidden).toBeFalse();
  });

  test("stops the previous startup on Restart before a new boot plays", async () => {
    const shell = await loadShell();
    const playing = new Set();
    let startupCount = 0;
    shell.window.Audio = function Audio(path) {
      const audio = {
        volume: 1,
        play: () => {
          playing.add(audio);
          if (path.endsWith("/startup.wav")) startupCount++;
          return Promise.resolve();
        },
        pause: () => playing.delete(audio),
        path,
      };
      return audio;
    };
    await login(shell);
    expect(startupCount).toBe(1);
    shell.document.getElementById("restart-confirm").click();
    await flushShell();
    expect(
      [...playing].filter((audio) => audio.path.endsWith("/startup.wav")),
    ).toHaveLength(0);
    await shell.advanceTime(1900);
    shell.completeBoot();
    shell.document.getElementById("welcome-screen").click();
    await flushShell();
    expect(startupCount).toBe(2);
    expect(
      [...playing].filter((audio) => audio.path.endsWith("/startup.wav")),
    ).toHaveLength(1);
  });
});
