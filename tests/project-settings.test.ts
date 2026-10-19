// @ts-nocheck -- Happy DOM supplies browser event and element types.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
async function setup(options = {}) {
  const s = await login(await loadShell(options));
  s.document
    .querySelector('[data-desktop-id="__astro-settings"]')
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  const content = s.document.querySelector(".project-settings-content");
  await flushShell();
  const action = (id) => content.querySelector(`[data-project-action="${id}"]`);
  const setting = (id, value) => {
    const el = content.querySelector(`[data-project-setting="${id}"]`);
    if (typeof value === "boolean") el.checked = value;
    else el.value = String(value);
    el.dispatchEvent(new s.window.Event("change", { bubbles: true }));
    return el;
  };
  const answer = async (text = "Yes") => {
    [...s.document.querySelectorAll(".xp-dialog .dlg-buttons button")]
      .find((b) => b.textContent === text)
      .click();
    await flushShell();
    await flushShell();
  };
  const state = (updates) => {
    Object.assign(s.offlineSnapshot, updates);
    s.notifyOfflineListeners();
  };
  return { s, content, action, setting, answer, state };
}
test("settings tabs, startup and update preferences invoke the manager and format delays", async () => {
  const calls = [];
  const h = await setup({
    offlineMethods: {
      setAutomaticUpdateDelay: (d) => calls.push(d),
      checkForUpdates: async (opts) => calls.push(opts),
      updateNow: async () => calls.push("update"),
    },
  });
  const tabs = [...h.content.querySelectorAll('[role="tab"]')];
  for (const [key, expected] of [
    ["End", 3],
    ["Home", 0],
    ["ArrowRight", 1],
    ["ArrowLeft", 3],
  ]) {
    h.s.document.activeElement?.blur();
    tabs[0].dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
    expect(h.content.querySelector('[aria-selected="true"]').id).toBe(
      tabs[expected].id,
    );
  }
  h.setting("full-startup", true);
  expect(h.s.window.localStorage.getItem("fullStartup")).toBe("true");
  h.setting("full-startup", false);
  expect(h.s.window.localStorage.getItem("fullStartup")).toBeNull();
  const startupVolume = h.content.querySelector(
    '[data-project-setting="startup-sound-volume"]',
  );
  const startupVolumeLabel = h.content.querySelector(
    '[data-project-value="startup-sound-volume"]',
  );
  const startupSound = () =>
    JSON.parse(h.s.window.localStorage.getItem("startupSound"));
  expect(
    h.content.querySelector('[data-project-setting="startup-sound"]').checked,
  ).toBeTrue();
  expect(startupVolume.value).toBe("50");
  expect(startupVolumeLabel.value).toBe("50%");
  startupVolume.value = "25";
  startupVolume.dispatchEvent(new h.s.window.Event("input"));
  expect(startupVolumeLabel.value).toBe("25%");
  h.setting("startup-sound-volume", 25);
  expect(startupSound()).toEqual({ enabled: true, volume: 25 });
  h.setting("startup-sound", false);
  expect(startupSound()).toEqual({ enabled: false, volume: 25 });
  expect(startupVolume.disabled).toBeTrue();
  h.setting("startup-sound", true);
  expect(startupVolume.disabled).toBeFalse();
  h.setting("save-played-games", false);
  expect(h.s.offlineSnapshot.savePlayedGamesOffline).toBeFalse();
  h.setting("automatic-updates", false);
  expect(h.s.offlineSnapshot.automaticUpdatesEnabled).toBeFalse();
  h.setting("automatic-updates", true);
  for (const [hours, label] of [
    [0, "No delay"],
    [1, "1 hour"],
    [24, "1 day"],
    [49, "2 days 1 hour"],
  ]) {
    const input = h.content.querySelector(
      '[data-project-setting="update-delay"]',
    );
    input.value = String(hours);
    input.dispatchEvent(new h.s.window.Event("input"));
    expect(
      h.content.querySelector('[data-project-value="update-delay"]').value,
    ).toBe(label);
    h.setting("update-delay", hours);
    expect(calls).toContain(hours * 3600000);
  }
  expect(calls).toContainEqual({ applyAutomatically: true });
  h.action("check").click();
  h.action("update-now").click();
  expect(calls).toContain("update");
  h.setting("offline-enabled", false);
  await h.answer("No");
  expect(h.s.offlineSnapshot.enabled).toBeTrue();
  h.setting("offline-enabled", false);
  await h.answer();
  expect(h.s.offlineSnapshot.enabled).toBeFalse();
  h.setting("offline-enabled", true);
  await flushShell();
  expect(h.s.offlineSnapshot.enabled).toBeTrue();
});
test("settings renders update progress, scheduled releases, storage and disabled states", async () => {
  const h = await setup();
  for (const phase of [
    "starting",
    "downloading",
    "checking",
    "updating",
    "applying",
    "repairing",
  ]) {
    h.state({ phase });
    expect(h.action("check").disabled).toBeTrue();
    expect(
      h.content.querySelector("[data-project-update-progress]").hidden,
    ).toBeFalse();
  }
  h.state({
    phase: "update-pending",
    updateEligibleAt: Date.now(),
    availableVersion: "next",
    lastChecked: Date.now(),
    usage: 1024,
    downloadBytes: null,
    downloadMetadataError: true,
  });
  expect(
    h.content.querySelector('[data-project-status="updates"]').textContent,
  ).toMatch(/^Updates on .+\.$/);
  h.state({ phase: "update-ready", updateReady: true });
  expect(
    h.content.querySelector('[data-project-status="updates"]').textContent,
  ).toContain("next visit");
  h.state({ phase: "ready", updateReady: false });
  expect(
    h.content.querySelector('[data-project-status="updates"]').textContent,
  ).toContain("is available");
  h.state({ availableVersion: null });
  expect(
    h.content.querySelector('[data-project-status="updates"]').textContent,
  ).toContain("Up to date.");
  h.state({
    phase: "error",
    error: "Disk full",
    online: false,
    usage: null,
    workerState: "waiting",
  });
  expect(
    h.content.querySelector('[data-project-status="updates"]').textContent,
  ).toBe("Disk full");
  // A service worker that's still installing reads as getting ready.
  expect(
    h.content.querySelector('[data-project-value="offlineFiles"]').textContent,
  ).toBe("Getting ready...");
  expect(h.action("update-now").disabled).toBeTrue();
  h.state({
    gamePhase: "downloading",
    activeGameId: "freecell",
    gameProgressLoaded: 2,
    gameProgressTotal: 4,
  });
  expect(h.content.querySelector("[data-project-game-progress]").value).toBe(2);
  h.state({ gamePhase: "removing", downloadedGameIds: ["freecell"] });
  // The saved size shows once a game is saved.
  expect(
    h.content.querySelector('[data-project-value="offlineGameStorage"]')
      .textContent,
  ).toMatch(/^ \(.+\)$/);
  expect(h.action("remove-all-games").disabled).toBeTrue();
  h.state({ gamePhase: "idle", enabled: false, bundledGames: [] });
  expect(
    h.content.querySelector("[data-project-offline-games]").textContent,
  ).toBe("");
  h.state({ enabled: true });
  expect(
    h.content.querySelector("[data-project-offline-games]").textContent,
  ).toContain("Loading");
  h.content.closest(".xp-window").querySelector(".close-btn").click();
  expect(h.content.isConnected).toBeFalse();
});
test("offline game downloads, removal and repair handle success, cancellation and errors", async () => {
  const calls = [];
  const fail = async () => {
    throw new Error("storage unavailable");
  };
  const h = await setup({
    offlineMethods: {
      removeGame: async (id) => calls.push(id),
      downloadAllGames: fail,
      removeAllGames: fail,
      repair: fail,
    },
  });
  const checkbox = h.content.querySelector('[data-offline-game="freecell"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new h.s.window.Event("change", { bubbles: true }));
  expect(h.s.offlineDownloads).toContain("freecell");
  const checked = h.content.querySelector('[data-offline-game="freecell"]');
  checked.checked = false;
  checked.dispatchEvent(new h.s.window.Event("change", { bubbles: true }));
  expect(calls).toEqual(["freecell"]);
  h.action("download-all-games").click();
  await flushShell();
  expect(
    h.content.querySelector('[data-project-status="offline-games"]')
      .textContent,
  ).toBe("storage unavailable");
  h.action("remove-all-games").click();
  await h.answer("No");
  h.action("remove-all-games").click();
  await h.answer();
  expect(
    h.content.querySelector('[data-project-status="offline-games"]')
      .textContent,
  ).toBe("storage unavailable");
  h.action("repair").click();
  await h.answer("No");
  h.action("repair").click();
  await h.answer();
  expect(
    h.content.querySelector('[data-project-status="offline"]').textContent,
  ).toBe("storage unavailable");
  for (const id of ["restore-desktop", "reset"]) {
    h.action(id).click();
    await h.answer("No");
  }
});
test("installed game data lists both stores, removes only the selected item and reports failures", async () => {
  const installed = [{ id: "internet", title: "Internet Game", bytes: 100 }],
    external = [{ id: "iso", title: "CD data", detail: "ISO", bytes: 200 }],
    removed = [];
  let fail = false;
  const library = {
    subscribe: () => () => {},
    initialize: async () => ({}),
    getInstallations: async () => installed,
    uninstall: async (id) => {
      removed.push(id);
      installed.length = 0;
    },
  };
  const data = {
    list: async () => external,
    remove: async (id) => {
      if (fail) throw new Error("remove failed");
      removed.push(id);
      external.length = 0;
    },
  };
  const h = await setup({
    gameLibraryManager: library,
    gameDataManager: data,
    offlineMethods: { refreshStorageEstimate: async () => {} },
  });
  h.content.querySelector("#project-tab-games").click();
  await flushShell();
  expect(h.content.querySelectorAll("[data-game-data-id]").length).toBe(2);
  h.content.querySelector('[data-game-data-id="internet"]').click();
  await h.answer();
  expect(removed).toEqual(["internet"]);
  fail = true;
  h.content.querySelector('[data-game-data-id="iso"]').click();
  await h.answer();
  expect(
    h.content.querySelector('[data-project-status="game-data"]').textContent,
  ).toBe("remove failed");
  fail = false;
  h.content.querySelector('[data-game-data-id="iso"]').click();
  await h.answer();
  expect(removed).toEqual(["internet", "iso"]);
  // With nothing installed, the group hides.
  expect(
    h.content.querySelector("[data-project-game-data-group]").hidden,
  ).toBeTrue();
  h.s.window.dispatchEvent(new h.s.window.StorageEvent("storage"));
  h.s.window.dispatchEvent(
    new h.s.window.MessageEvent("message", {
      origin: h.s.window.location.origin,
      data: { event: "astro.game-data-changed" },
    }),
  );
  await flushShell();
  expect(
    h.content.querySelector('[data-project-status="game-data"]').textContent,
  ).toBe("");
});
const openDateTime = async (options = {}) => {
  const s = await login(await loadShell(options));
  s.document
    .getElementById("taskbar-clock")
    .dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  const dialog = s.document.querySelector(".datetime-dialog");
  const button = (text) =>
    [...dialog.querySelectorAll("button")].find((b) => b.textContent === text);
  const control = (selector) => dialog.querySelector(selector);
  const change = (selector, value) => {
    const el = control(selector);
    if (typeof value === "boolean") el.checked = value;
    else el.value = value;
    el.dispatchEvent(new s.window.Event("change", { bubbles: true }));
    return el;
  };
  return { s, dialog, button, control, change };
};

test("date and time properties set the date, the time, and the shell clock", async () => {
  const { s, dialog, button, control, change } = await openDateTime();
  expect(s.document.activeElement).toBe(control('[aria-label="Month"]'));
  const year = change('[aria-label="Year"]', "2024");
  change('[aria-label="Month"]', "1");
  expect(dialog.querySelectorAll(".dlg-calendar-day").length).toBe(29);
  [...dialog.querySelectorAll(".dlg-calendar-day")]
    .find((b) => b.textContent === "29")
    .click();
  change('[aria-label="Year"]', "2025");
  expect(control(".dlg-calendar-day.selected").textContent).toBe("28");
  change('[aria-label="Year"]', "2500");
  expect(year.value).toBe("2099");
  change('[aria-label="Year"]', "1800");
  expect(year.value).toBe("1901");
  change('[aria-label="Year"]', "");
  expect(year.value).toBe("1901");
  control('[aria-label="Next year"]').click();
  expect(year.value).toBe("1902");
  control('[aria-label="Previous year"]').click();
  control(".datetime-year-spin").click();
  expect(year.value).toBe("1901");
  change('[aria-label="Year"]', "2025");

  // The up-down changes the part of the time the caret was last in.
  const time = control('[aria-label="Time"]');
  time.dispatchEvent(new s.window.Event("input"));
  change('[aria-label="Time"]', "11:59:59 PM");
  const spin = (label, caret) => {
    if (caret !== undefined) {
      time.setSelectionRange(caret, caret);
      time.dispatchEvent(new s.window.MouseEvent("click"));
    }
    control(`[aria-label="${label}"]`).click();
    return time.value;
  };
  expect(spin("Increase time")).toBe("12:59:59 AM");
  expect(spin("Increase time", 4)).toBe("1:00:59 AM");
  time.dispatchEvent(new s.window.KeyboardEvent("keyup"));
  expect(spin("Decrease time", 7)).toBe("1:00:58 AM");
  expect(spin("Increase time", 9)).toBe("1:00:58 PM");
  control(".datetime-time-spin").click();
  expect(time.value).toBe("1:00:58 PM");

  // The clock stops while the time is being edited.
  await s.advanceTime(1000);
  expect(time.value).toBe("1:00:58 PM");
  button("Apply").click();
  expect(button("Apply").disabled).toBeTrue();
  const shellTime = () =>
    new Date(
      Date.now() + Number(s.window.localStorage.getItem("clockOffsetMs")),
    );
  const chosen = shellTime();
  expect([
    chosen.getFullYear(),
    chosen.getMonth(),
    chosen.getDate(),
    chosen.getHours(),
    chosen.getMinutes(),
  ]).toEqual([2025, 1, 28, 13, 0]);
  await s.advanceTime(1000);
  expect(time.value).toBe(
    shellTime().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
  );

  change('[aria-label="Time"]', "invalid");
  expect(time.value).toBe("12:00:00 AM");
  button("OK").click();
  expect(dialog.isConnected).toBeFalse();
  await s.advanceTime(1000);
});

test("date and time properties change the time zone and synchronize the clock", async () => {
  const { s, dialog, button, control, change } = await openDateTime();
  const storage = s.window.localStorage;
  const hostOffset = -new Date().getTimezoneOffset();
  const zone = control('[aria-label="Time zone"]');
  const startZone = zone.value;
  button("Time Zone").click();
  expect(control(".datetime-time-zone-panel").hidden).toBeFalse();
  expect(s.document.activeElement).toBe(zone);
  expect(zone.options.length).toBe(75);
  const before = Number(storage.getItem("clockOffsetMs") || 0);
  change('[aria-label="Time zone"]', "Nepal");
  button("Apply").click();
  expect(storage.getItem("timeZone")).toBe("Nepal");
  expect(control(".datetime-current-zone").textContent).toBe(
    "Current time zone:  Nepal Standard Time",
  );
  // The clock moves by the difference between the zones, give or take the
  // second the time box rounds away.
  const [, sign, hours, minutes] = /^\(GMT(?:([+-])(\d\d):(\d\d))?\)/.exec(
    [...zone.options].find((o) => o.value === startZone).textContent,
  );
  const startOffset = (sign === "-" ? -1 : 1) * (+hours * 60 + +minutes || 0);
  const shift = Number(storage.getItem("clockOffsetMs")) - before;
  expect(Math.abs(shift - (345 - startOffset) * 60000)).toBeLessThan(2000);

  button("Internet Time").click();
  expect(s.document.activeElement).toBe(control(".datetime-sync-label input"));
  expect(control(".datetime-sync-status").textContent).toBe(
    "Windows has never attempted to synchronize with an internet time server.",
  );
  change(".datetime-sync-label input", false);
  expect(button("Update Now").disabled).toBeTrue();
  expect(control(".datetime-next-sync").hidden).toBeTrue();
  expect(JSON.parse(storage.getItem("timeSync")).enabled).toBeFalse();
  change(".datetime-sync-label input", true);
  change(".datetime-server-select", "time.nist.gov");
  button("Update Now").click();
  expect(Number(storage.getItem("clockOffsetMs"))).toBe(
    (345 - hostOffset) * 60000,
  );
  expect(control(".datetime-sync-status").textContent).toMatch(
    /^The time has been successfully synchronized with time\.nist\.gov on \d+\/\d+\/\d{4} at \d+:\d{2} [AP]M\.$/,
  );
  const sync = JSON.parse(storage.getItem("timeSync"));
  expect(sync.server).toBe("time.nist.gov");
  expect(control(".datetime-next-sync").textContent).toContain(
    new Intl.DateTimeFormat("en-US").format(sync.last + 7 * 86400000),
  );

  dialog.querySelector('[aria-label="Help"]').click();
  dialog
    .querySelector(".datetime-sync-status")
    .dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  expect(s.document.querySelector(".xp-help-popup").textContent).toBe(
    "No Help topic is associated with this item.",
  );
  button("Date & Time").click();
  expect(control(".datetime-date-panel").hidden).toBeFalse();
});

test("date and time properties restore the saved zone and synchronization", async () => {
  const last = new Date(2026, 0, 2, 9, 30).getTime();
  const { s, button, control } = await openDateTime({
    initialStorage: {
      timeZone: "Tokyo",
      timeSync: JSON.stringify({
        enabled: false,
        server: "time.nist.gov",
        last,
      }),
    },
  });
  expect(control(".datetime-current-zone").textContent).toBe(
    "Current time zone:  Tokyo Standard Time",
  );
  expect(control('[aria-label="Time zone"]').value).toBe("Tokyo");
  expect(control(".datetime-sync-label input").checked).toBeFalse();
  expect(control(".datetime-server-select").value).toBe("time.nist.gov");
  expect(button("Update Now").disabled).toBeTrue();
  expect(control(".datetime-sync-status").textContent).toBe(
    "The time has been successfully synchronized with time.nist.gov on 1/2/2026 at 9:30 AM.",
  );
  expect(control(".datetime-next-sync").textContent).toBe(
    "Next synchronization: 1/9/2026 at 9:30 AM",
  );
  button("Cancel").click();

  s.window.localStorage.setItem("timeSync", "{");
  s.document.documentElement.dataset.xpAppearance = "classic";
  s.document
    .getElementById("taskbar-clock")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  const dialog = s.document.querySelector(".datetime-dialog");
  expect(dialog.querySelector(".datetime-sync-label input").checked).toBeTrue();
  expect(dialog.querySelector(".datetime-server-select").value).toBe(
    "time.windows.com",
  );
  // Olive Green shares Blue's 3D shadow.
  dialog.querySelector('[data-action="cancel"]').click();
  s.document.documentElement.dataset.xpAppearance = "olive";
  s.document
    .getElementById("taskbar-clock")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  expect(s.document.querySelector(".datetime-dialog")).not.toBeNull();
});

test("date and time properties pick the host's zone by name, then by offset", async () => {
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  const getTimezoneOffset = Date.prototype.getTimezoneOffset;
  const open = async (name, offset) => {
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...resolvedOptions.call(this), timeZone: name };
    };
    Date.prototype.getTimezoneOffset = () => offset;
    const { control } = await openDateTime();
    return control('[aria-label="Time zone"]').value;
  };
  try {
    expect(await open("America/Argentina/Buenos_Aires", 180)).toBe(
      "SA Eastern",
    );
    expect(await open("Mars/Base", -345)).toBe("Nepal");
    expect(await open("Mars/Base", 7)).toBe("GMT");
  } finally {
    Intl.DateTimeFormat.prototype.resolvedOptions = resolvedOptions;
    Date.prototype.getTimezoneOffset = getTimezoneOffset;
  }
});

test("restoring the desktop and resetting reload the page or report failures", async () => {
  const h = await setup();
  let reloads = 0;
  Object.defineProperty(h.s.window.location, "reload", {
    configurable: true,
    value: () => reloads++,
  });
  for (const id of ["restore-desktop", "reset"]) {
    h.action(id).click();
    await h.answer("Yes");
    await flushShell();
  }
  expect(reloads).toBe(2);
  const transaction = h.s.window.VirtualFS.transaction;
  const reset = h.s.window.VirtualFS.reset;
  h.s.window.VirtualFS.transaction = async () => {
    throw new Error("");
  };
  h.s.window.VirtualFS.reset = async () => {
    throw new Error("");
  };
  try {
    for (const id of ["restore-desktop", "reset"]) {
      h.action(id).click();
      await h.answer("Yes");
      await flushShell();
      expect(
        [...h.s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
      ).toContain("Something went wrong.");
      await h.answer("OK");
    }
  } finally {
    h.s.window.VirtualFS.transaction = transaction;
    h.s.window.VirtualFS.reset = reset;
  }
});

test("settings report failed offline changes and skip update checks when automatic updates are off", async () => {
  const calls = [];
  let gamesChanged;
  const h = await setup({
    offlineSettings: { automaticUpdatesEnabled: false },
    gameLibraryManager: {
      subscribe: (listener) => {
        gamesChanged = listener;
        return () => {};
      },
      initialize: async () => ({}),
      getInstallations: async () => [],
    },
    offlineMethods: {
      setOfflineEnabled: async () => {
        throw new Error("worker unavailable");
      },
      downloadGame: async () => {
        throw new Error("quota exceeded");
      },
      checkForUpdates: async (options) => {
        calls.push(options);
        throw new Error("offline");
      },
      updateNow: async () => {
        throw new Error("offline");
      },
      refreshStorageEstimate: async () => {},
    },
  });
  h.setting("update-delay", 2);
  expect(calls).toEqual([]);
  h.action("check").click();
  h.action("update-now").click();
  await flushShell();
  h.setting("offline-enabled", false);
  await h.answer("Yes");
  await flushShell();
  expect(
    h.content.querySelector('[data-project-status="offline"]').textContent,
  ).toBe("worker unavailable");
  const checkbox = h.content.querySelector('[data-offline-game="freecell"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new h.s.window.Event("change", { bubbles: true }));
  await flushShell();
  expect(
    h.content.querySelector('[data-project-status="offline-games"]')
      .textContent,
  ).toBe("quota exceeded");
  h.content
    .querySelector("[data-project-offline-games], .project-offline-games")
    ?.dispatchEvent(new h.s.window.Event("change", { bubbles: true }));
  gamesChanged({});
  await flushShell();
});

test("game data removal ignores stray clicks and declined confirmations", async () => {
  const external = [{ id: "iso", title: "CD data", detail: "ISO", bytes: 1 }];
  const removed = [];
  const h = await setup({
    gameDataManager: {
      list: async () => external,
      remove: async (id) => removed.push(id),
    },
  });
  h.content.querySelector("#project-tab-games").click();
  await flushShell();
  const list = h.content.querySelector("[data-project-game-data]");
  list.dispatchEvent(new h.s.window.MouseEvent("click", { bubbles: true }));
  h.content.querySelector('[data-game-data-id="iso"]').click();
  await h.answer("No");
  expect(removed).toEqual([]);
});

test("settings describe unusual offline states", async () => {
  const h = await setup();
  const value = (id) =>
    h.content.querySelector(`[data-project-value="${id}"]`)?.textContent;
  h.state({
    phase: "mystery",
    workerState: "",
    downloadBytes: null,
    downloadMetadataError: false,
    updateReady: true,
    availableVersion: null,
    automaticUpdateDelayMs: null,
    releaseUpdateDelayMs: 2 * 60 * 60 * 1000,
  });
  expect(value("offlineFiles")).toBe("Unavailable");
  expect(value("downloadSize")).toBe("Checking...");
  expect(
    h.content.querySelector('[data-project-status="offline"]').textContent,
  ).toBe("");
  expect(h.content.textContent).toContain(
    "The update opens on your next visit.",
  );
  expect(
    h.content.querySelector('[data-project-setting="update-delay"]').value,
  ).toBe("2");
  h.s.window.dispatchEvent(
    new h.s.window.MessageEvent("message", {
      origin: "https://elsewhere.example",
      data: { event: "astro.game-data-changed" },
    }),
  );
  h.s.window.dispatchEvent(
    new h.s.window.MessageEvent("message", {
      origin: h.s.window.location.origin,
      data: { event: "other" },
    }),
  );
});

test("the tray volume menu opens Volume Control and invalid levels fall back to the midpoint", async () => {
  const s = await login(
    await loadShell({
      initialStorage: { taskbarSettings: JSON.stringify({ edge: "top" }) },
    }),
  );
  const button = s.document.getElementById("tray-volume-button");
  button.click();
  expect(s.document.getElementById("tray-volume-popup").hidden).toBeFalse();
  const slider = s.document.getElementById("tray-volume-slider");
  slider.value = "abc";
  slider.dispatchEvent(new s.window.Event("input"));
  expect(s.window.localStorage.getItem("volume")).toBe("50");
  button.dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  const menu = s.document.getElementById("tray-volume-menu");
  expect(menu.hidden).toBeFalse();
  menu.querySelector("button").click();
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__volume-control"]'),
  ).toBeTrue();
  const clock = s.document.getElementById("taskbar-clock");
  clock.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  clock.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
  );
  expect(!!s.document.querySelector(".xp-dialog")).toBeTrue();
});

test("offline initialization failures and played-game downloads are reported", async () => {
  const errors = [];
  const warnings = [];
  const s = await loadShell({
    offlineSettings: { savePlayedGamesOffline: true, enabled: true },
    offlineMethods: {
      initialize: async () => {
        throw new Error("worker blocked");
      },
      downloadGame: async () => {
        throw new Error("quota");
      },
    },
  });
  s.window.console.error = (...args) => errors.push(args);
  s.window.console.warn = (...args) => warnings.push(args);
  await login(s);
  await flushShell();
  s.window.history.replaceState(null, "", "#freecell");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await flushShell();
  await flushShell();
  Object.defineProperty(s.window.navigator, "onLine", {
    configurable: true,
    value: false,
  });
  s.window.history.replaceState(null, "", "#inside-the-firewall");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await flushShell();
  expect(warnings.length + errors.length).toBeGreaterThan(0);
});

test("the full startup preference reads as off when storage is unreadable", async () => {
  const s = await login(
    await loadShell({ initialStorage: { fullStartup: "true" } }),
  );
  const storage = s.window.localStorage;
  Object.defineProperty(s.window, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        if (key === "fullStartup") throw new Error("storage blocked");
        return storage.getItem(key);
      },
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    },
  });
  s.document
    .querySelector('[data-desktop-id="__astro-settings"]')
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await flushShell();
  expect(
    s.document.querySelector('[data-project-setting="full-startup"]').checked,
  ).toBeFalse();
});

test("the development server skips offline mode and settings describe download errors", async () => {
  let initialized = 0;
  const h = await setup({
    beforeScripts: (window) => {
      window.ASTRO_DEV = true;
    },
    offlineSettings: {
      gameError: "The disk is full.",
      automaticUpdateDelayMs: null,
      releaseUpdateDelayMs: null,
    },
    offlineMethods: {
      initialize: async () => {
        initialized += 1;
      },
    },
  });
  expect(initialized).toBe(0);
  expect(
    h.content.querySelector('[data-project-status="offline-games"]')
      .textContent,
  ).toBe("The disk is full.");
  expect(
    h.content.querySelector('[data-project-setting="update-delay"]').value,
  ).toBe("6");
});

test("settings tabs ignore unrelated keys and failed update checks after a delay change", async () => {
  const checks = [];
  const h = await setup({
    offlineMethods: {
      checkForUpdates: async (options) => {
        checks.push(options);
        throw new Error("offline");
      },
    },
  });
  const tabs = [...h.content.querySelectorAll('[role="tab"]')];
  const selected = () => h.content.querySelector('[aria-selected="true"]').id;
  const before = selected();
  const event = new h.s.window.KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
  });
  tabs[0].dispatchEvent(event);
  expect(event.defaultPrevented).toBeFalse();
  expect(selected()).toBe(before);
  h.setting("update-delay", 4);
  await flushShell();
  expect(checks).toEqual([{ applyAutomatically: true }]);
});

test("installed game data reports listing failures but ignores failures of stale refreshes", async () => {
  let failFirst;
  let listings = 0;
  const h = await setup({
    gameDataManager: {
      list: () => {
        listings += 1;
        return listings === 1
          ? new Promise((_resolve, reject) => (failFirst = reject))
          : Promise.reject(new Error("Storage is locked."));
      },
      remove: async () => {},
    },
  });
  const status = () =>
    h.content.querySelector('[data-project-status="game-data"]').textContent;
  h.content.querySelector("#project-tab-games").click();
  await flushShell();
  h.s.window.dispatchEvent(new h.s.window.StorageEvent("storage"));
  await flushShell();
  expect(status()).toBe("Storage is locked.");
  failFirst(new Error("stale failure"));
  await flushShell();
  expect(status()).toBe("Storage is locked.");
});

test("offers a reload once when a newer release removed a file", async () => {
  const calls = [];
  let reloads = 0;
  const s = await login(
    await loadShell({
      offlineMethods: {
        updateNow: async () => {
          calls.push("update");
          throw new Error("offline");
        },
      },
    }),
  );
  s.window.location.reload = () => {
    reloads += 1;
  };
  const prompt = () =>
    [...s.document.querySelectorAll(".xp-dialog")].find((dialog) =>
      dialog.textContent.includes("Reload to update"),
    );
  const press = async (label) => {
    [...prompt().querySelectorAll(".dlg-buttons button")]
      .find((button) => button.textContent === label)
      .click();
    await flushShell();
    await flushShell();
  };
  const state = async (updates) => {
    Object.assign(s.offlineSnapshot, updates);
    s.notifyOfflineListeners();
    await flushShell();
  };

  await state({ reloadRequired: false });
  expect(prompt()).toBeUndefined();
  await state({ reloadRequired: true });
  expect(prompt().getAttribute("role")).toBe("dialog");
  await press("Reload");
  // With offline use on, Update Now reloads; if it fails, a plain reload.
  expect(calls).toEqual(["update"]);
  expect(reloads).toBe(1);

  await state({ reloadRequired: true });
  expect(prompt()).toBeUndefined();
});

test("the reload prompt reloads directly with offline use off, or waits", async () => {
  for (const [label, expected] of [
    ["Reload", 1],
    ["Later", 0],
  ]) {
    let reloads = 0;
    const s = await login(
      await loadShell({ offlineSettings: { enabled: false } }),
    );
    s.window.location.reload = () => {
      reloads += 1;
    };
    Object.assign(s.offlineSnapshot, { reloadRequired: true });
    s.notifyOfflineListeners();
    await flushShell();
    [...s.document.querySelectorAll(".xp-dialog .dlg-buttons button")]
      .find((button) => button.textContent === label)
      .click();
    await flushShell();
    await flushShell();
    expect(reloads).toBe(expected);
    cleanupShells();
  }
});
