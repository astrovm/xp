// @ts-nocheck -- Happy DOM supplies the shell's browser objects.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  clickStartAction,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
async function open() {
  const s = await login(await loadShell());
  clickStartAction(s, "controlPanel");
  s.document
    .querySelector('[data-control-panel-category="appearance"]')
    .click();
  s.document.querySelector('[data-control-panel-action="display"]').click();
  const d = s.document.querySelector(".display-properties-content");
  const q = (selector) => d.querySelector(selector);
  const change = (selector, value, type = "change") => {
    const el = q(selector);
    el.value = value;
    el.dispatchEvent(new s.window.Event(type, { bubbles: true }));
  };
  const key = (el, key) =>
    el.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  const saved = () =>
    JSON.parse(s.window.localStorage.getItem("displaySettings"));
  const dialogButton = (dialog, label) =>
    [...dialog.querySelectorAll(".dlg-buttons button")]
      .find((b) => b.textContent === label)
      .click();
  return { s, d, q, change, key, saved, dialogButton };
}
test("display tabs, wallpaper selection and preference controls persist together", async () => {
  const h = await open();
  const { q, change, key } = h;
  const tabs = [...h.d.querySelectorAll('[role="tab"]')];
  for (const tab of tabs) {
    tab.click();
    expect(q("#" + tab.getAttribute("aria-controls")).hidden).toBeFalse();
  }
  for (const k of ["Home", "ArrowRight", "ArrowLeft", "End"]) key(tabs[0], k);
  expect(tabs.at(-1).getAttribute("aria-selected")).toBe("true");
  change("#display-theme", "classic");
  change("#display-wallpaper", "ascent");
  const list = q(".display-wallpaper-list");
  for (const k of ["Home", "ArrowDown", "ArrowUp", "End"]) key(list, k);
  expect(list.querySelector('[aria-selected="true"]')).not.toBeNull();
  change("#display-position", "tile");
  change("#display-color", "#123456", "input");
  change("#display-appearance", "silver");
  change("#display-font-size", "large");
  change("#display-saver-wait", "99");
  q(".display-saver-login").click();
  q('[data-display-action="apply"]').click();
  expect(h.saved()).toMatchObject({
    position: "tile",
    backgroundColor: "#123456",
    appearance: "silver",
    fontSize: "large",
    screenSaverWait: 60,
  });
  expect(q('[data-display-action="apply"]').disabled).toBeTrue();
  q('[data-display-action="ok"]').click();
  expect(h.d.isConnected).toBeFalse();
});
test("effects and advanced appearance commit drafts and cancel safely", async () => {
  const h = await open();
  const { s, q } = h;
  for (const commit of [false, true]) {
    q(".display-effects").click();
    const dialog = s.document.querySelector(".display-effects-dialog");
    const transition = dialog.querySelector(
      '[data-effect-enabled="transition"]',
    );
    transition.click();
    expect(
      dialog.querySelector('[data-effect="transitionEffect"]').disabled,
    ).toBe(!transition.checked);
    dialog.querySelector('[data-effect-enabled="smoothing"]').click();
    dialog.querySelector('[data-effect="largeIcons"]').click();
    h.dialogButton(dialog, commit ? "OK" : "Cancel");
    await flushShell();
    expect(dialog.isConnected).toBeFalse();
  }
  q(".display-advanced-appearance").click();
  let advanced = s.document.querySelector(".advanced-appearance-dialog");
  advanced.querySelector("[data-advanced-color]").value = "#654321";
  h.dialogButton(advanced, "OK");
  await flushShell();
  expect(q("#display-color").value).toBe("#654321");
  q(".display-advanced-appearance").click();
  advanced = s.document.querySelector(".advanced-appearance-dialog");
  h.dialogButton(advanced, "Cancel");
  q('[data-display-action="apply"]').click();
  expect(h.saved().backgroundColor).toBe("#654321");
  expect(h.saved().largeIcons).toBeTrue();
});
test("desktop icon customization toggles visibility and restores owner focus", async () => {
  const h = await open();
  const { s, q } = h;
  q(".display-customize").click();
  const dialog = s.document.querySelector(".desktop-items-dialog");
  dialog.querySelector('[data-desktop-items-tab="web"]').click();
  expect(
    dialog.querySelector('[data-desktop-items-panel="web"]').hidden,
  ).toBeFalse();
  dialog.querySelector('[data-desktop-items-tab="general"]').click();
  const choices = [...dialog.querySelectorAll(".desktop-icon-choices button")];
  choices[1].click();
  expect(choices[1].classList.contains("selected")).toBeTrue();
  dialog.querySelector('[data-system-icon="__my-computer"]').click();
  h.dialogButton(dialog, "OK");
  await flushShell();
  expect(
    s.document.querySelector('[data-desktop-id="__my-computer"]'),
  ).toBeNull();
  q(".display-customize").click();
  h.dialogButton(s.document.querySelector(".desktop-items-dialog"), "Cancel");
  await flushShell();
  expect(s.document.querySelector(".desktop-items-dialog")).toBeNull();
});
test("Browse rejects non-pictures and lists a chosen picture by name", async () => {
  const h = await open();
  const { s, q } = h;
  q(".display-browse").click();
  const input = q("#display-image");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new s.window.File(["no"], "bad.txt", { type: "text/plain" })],
  });
  input.dispatchEvent(new s.window.Event("change"));
  const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(error.textContent).toContain("bad.txt is not a picture");
  expect(error.querySelector(".dlg-icon-error")).not.toBeNull();
  const owner = h.d.closest(".xp-window");
  expect(owner.classList.contains("active")).toBeFalse();
  h.dialogButton(error, "OK");
  await flushShell();
  // Browse is still open, so the error closing keeps the owner inactive.
  expect(s.document.querySelector(".wallpaper-browse-dialog")).not.toBeNull();
  expect(owner.classList.contains("active")).toBeFalse();
  const custom = q(".display-custom-wallpaper");
  expect(custom.hidden).toBeTrue();
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new s.window.File(["image"], "art.png", { type: "image/png" })],
  });
  input.dispatchEvent(new s.window.Event("change"));
  for (let i = 0; i < 20 && custom.hidden; i++) await flushShell();
  expect(custom.hidden).toBeFalse();
  expect(custom.textContent).toBe("art");
  expect(custom.getAttribute("aria-selected")).toBe("true");
  expect(s.document.querySelector(".wallpaper-browse-dialog")).toBeNull();
  q('[data-display-action="apply"]').click();
  expect(h.saved()).toMatchObject({ customWallpaperName: "art" });
  expect(h.saved().customWallpaper).toStartWith("data:image/png");
  // Clicking the listed picture keeps it; picking another wallpaper drops it.
  custom.click();
  expect(q('[data-display-action="apply"]').disabled).toBeTrue();
  q('[data-wallpaper="azul"]').click();
  expect(custom.hidden).toBeTrue();
  q('[data-display-action="apply"]').click();
  expect(h.saved()).toMatchObject({
    wallpaper: "azul",
    customWallpaper: "",
    customWallpaperName: "",
  });
  q(".display-browse").click();
  h.dialogButton(
    s.document.querySelector(".wallpaper-browse-dialog"),
    "Cancel",
  );
});
test("resolution preview rolls back on cancel and saver settings stay usable", async () => {
  const h = await open();
  const { s, q, change } = h;
  change("#display-resolution", "800x600");
  expect(q(".display-resolution-value").textContent).toContain("800 by 600");
  change("#display-resolution", "auto");
  change("#display-resolution-slider", "2", "input");
  expect(q(".display-resolution-value").textContent).toContain("1440 by 900");
  change("#display-saver", "blank");
  q(".display-saver-settings").click();
  const notice = s.document.querySelector(".xp-dialog-overlay");
  expect(notice.textContent).toContain("no options");
  h.dialogButton(notice, "OK");
  await flushShell();
  q(".display-saver-preview-button").click();
  expect(s.document.getElementById("screen-saver-overlay").hidden).toBeFalse();
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(s.document.getElementById("screen-saver-overlay").hidden).toBeTrue();
  q('[data-display-action="cancel"]').click();
  expect(h.d.isConnected).toBeFalse();
  expect(h.saved()).toBeNull();
});

test("secondary display dialogs cancel with Escape and ignore clicks between controls", async () => {
  const h = await open();
  const { s, q } = h;
  const escape = (dialog) =>
    dialog.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  q(".display-customize").click();
  const items = s.document.querySelector(".desktop-items-dialog");
  items
    .querySelector(".desktop-items-tabs")
    .dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  items
    .querySelector(".desktop-icon-choices")
    .dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  escape(items);
  expect(items.isConnected).toBeFalse();
  q(".display-effects").click();
  escape(s.document.querySelector(".display-effects-dialog"));
  q(".display-advanced-appearance").click();
  escape(s.document.querySelector(".advanced-appearance-dialog"));
  q(".display-browse").click();
  const browse = s.document.querySelector(".wallpaper-browse-dialog");
  // Browse is XP's standard Open dialog: Look in My Pictures, real toolbar
  // icons, and an enabled Background Files type list.
  expect(browse.classList.contains("xp-file-dialog")).toBeTrue();
  const lookIn = browse.querySelector(".dlg-file-folder");
  expect(lookIn.selectedOptions[0].textContent).toBe("My Pictures");
  expect(
    [...browse.querySelectorAll(".dlg-file-tool img")].map((img) =>
      img.getAttribute("src"),
    ),
  ).toEqual([
    "assets/xp/icons/Back.png",
    "assets/xp/icons/Up.png",
    "assets/xp/icons/NewFolder.png",
  ]);
  const type = browse.querySelector(".dlg-file-type");
  expect(type.disabled).toBeFalse();
  expect(type.selectedOptions[0].textContent).toBe(
    "Background Files (*.png;*.jpg;*.jpeg;*.gif;*.webp)",
  );
  expect(browse.querySelector(".help-btn")).not.toBeNull();
  let picked = 0;
  const image = q("#display-image");
  let cleared = 0;
  Object.defineProperty(image, "value", {
    configurable: true,
    get: () => "",
    set: (value) => value === "" && cleared++,
  });
  image.click = () => picked++;
  h.dialogButton(browse, "Open");
  // Open clears the last pick, so picking the same picture again works.
  expect(cleared).toBe(1);
  expect(picked).toBe(1);
  escape(browse);
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
  await flushShell();
  expect(h.d.closest(".xp-window").classList.contains("active")).toBeTrue();
});

test("effects restore scroll transitions and ClearType and can turn both off", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        displaySettings: JSON.stringify({
          transitionEffect: "scroll",
          fontSmoothing: "cleartype",
        }),
      },
    }),
  );
  clickStartAction(s, "controlPanel");
  s.document
    .querySelector('[data-control-panel-category="appearance"]')
    .click();
  s.document.querySelector('[data-control-panel-action="display"]').click();
  const content = s.document.querySelector(".display-properties-content");
  content.querySelector(".display-effects").click();
  const dialog = s.document.querySelector(".display-effects-dialog");
  expect(dialog.querySelector('[data-effect="transitionEffect"]').value).toBe(
    "scroll",
  );
  expect(dialog.querySelector('[data-effect="fontSmoothing"]').value).toBe(
    "cleartype",
  );
  // Menus and tooltips pick up the saved effect straight away.
  expect(s.document.documentElement.dataset.xpMenuTransition).toBe("scroll");
  dialog.querySelector('[data-effect-enabled="transition"]').click();
  dialog.querySelector('[data-effect-enabled="smoothing"]').click();
  [...dialog.querySelectorAll(".dlg-buttons button")]
    .find((button) => button.textContent === "OK")
    .click();
  content.querySelector('[data-display-action="apply"]').click();
  expect(
    JSON.parse(s.window.localStorage.getItem("displaySettings")),
  ).toMatchObject({ transitionEffect: "none", fontSmoothing: "none" });
  expect(s.document.documentElement.dataset.xpMenuTransition).toBe("none");
});

test("the wallpaper list moves with the keyboard and skips hidden items", async () => {
  const h = await open();
  const { s, q } = h;
  q('[role="tab"][aria-controls="display-panel-desktop"]').click();
  const list = q(".display-wallpaper-list");
  const selected = () => list.querySelector('[aria-selected="true"]');
  const key = (k) =>
    list.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
  key("Home");
  expect(selected().dataset.wallpaper).toBe("none");
  key("ArrowUp");
  expect(selected().dataset.wallpaper).toBe("none");
  key("ArrowDown");
  expect(selected().dataset.wallpaper).toBe("ascent");
  key("End");
  expect(selected().dataset.wallpaper).toBe("zapotec");
  key("a");
  list.dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  q('[role="tab"]').dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  expect(selected().dataset.wallpaper).toBe("zapotec");
});

test("display settings reject empty choices and report save failures", async () => {
  const h = await open();
  const { s, q, change } = h;
  change("#display-saver-wait", "abc");
  change("#display-saver", "none");
  expect(q(".display-saver-preview-button").disabled).toBeTrue();
  expect(q(".display-saver-settings").disabled).toBeTrue();
  q("#display-image").dispatchEvent(new s.window.Event("change"));
  change("#display-position", "tile");
  const realStorage = s.window.localStorage;
  const errors = [];
  const originalError = s.window.console.error;
  s.window.console.error = (...args) => errors.push(args);
  Object.defineProperty(s.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => realStorage.getItem(key),
      removeItem: (key) => realStorage.removeItem(key),
      setItem(key, value) {
        if (key === "displaySettings") throw new Error("quota");
        realStorage.setItem(key, value);
      },
    },
  });
  try {
    q('[data-display-action="ok"]').click();
    const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
    expect(error.textContent).toContain("could not save");
    expect(h.d.isConnected).toBeTrue();
    expect(errors).toHaveLength(1);
    h.dialogButton(error, "OK");
    await flushShell();
  } finally {
    Object.defineProperty(s.window, "localStorage", {
      configurable: true,
      value: realStorage,
    });
    s.window.console.error = originalError;
  }
  q('[data-display-action="apply"]').click();
  q('[data-display-action="ok"]').click();
  expect(h.d.isConnected).toBeFalse();
});

test("the 3D Pipes preview keeps running while other saver settings change", async () => {
  const h = await open();
  const { q, change } = h;
  h.d.querySelector('[aria-controls="display-panel-saver"]').click();
  change("#display-saver", "pipes");
  const preview = q(".pipes-screen-saver");
  expect(preview).not.toBeNull();
  change("#display-saver-wait", "5");
  expect(q(".pipes-screen-saver")).toBe(preview);
  h.d.querySelector('[aria-controls="display-panel-desktop"]').click();
  expect(q(".pipes-screen-saver")).toBeNull();
});

test("effects save the chosen transition and font smoothing when enabled", async () => {
  const h = await open();
  const { s, q } = h;
  q(".display-effects").click();
  const dialog = s.document.querySelector(".display-effects-dialog");
  for (const [effect, enabled, value] of [
    ["transitionEffect", "transition", "scroll"],
    ["fontSmoothing", "smoothing", "cleartype"],
  ]) {
    const toggle = dialog.querySelector(`[data-effect-enabled="${enabled}"]`);
    if (!toggle.checked) toggle.click();
    const select = dialog.querySelector(`[data-effect="${effect}"]`);
    expect(select.disabled).toBeFalse();
    select.value = value;
  }
  h.dialogButton(dialog, "OK");
  q('[data-display-action="apply"]').click();
  expect(h.saved()).toMatchObject({
    transitionEffect: "scroll",
    fontSmoothing: "cleartype",
  });
});

test("a picture chosen after its browse dialog closed still becomes the wallpaper", async () => {
  const h = await open();
  const { s, q } = h;
  q(".display-browse").click();
  h.dialogButton(
    s.document.querySelector(".wallpaper-browse-dialog"),
    "Cancel",
  );
  const input = q("#display-image");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new s.window.File(["image"], "late.png", { type: "image/png" })],
  });
  input.dispatchEvent(new s.window.Event("change"));
  for (let i = 0; i < 20 && q(".display-custom-wallpaper").hidden; i++)
    await flushShell();
  expect(q(".display-custom-wallpaper").textContent).toBe("late");
  expect(s.document.querySelector(".wallpaper-browse-dialog")).toBeNull();
});

test("a stored custom wallpaper is restored on the desktop", async () => {
  const wallpaper = "data:image/png;base64,iVBORw0KGgo=";
  const s = await login(
    await loadShell({
      initialStorage: {
        displaySettings: JSON.stringify({ customWallpaper: wallpaper }),
      },
    }),
  );
  expect(
    s.document
      .getElementById("desktop")
      .style.getPropertyValue("--desktop-background"),
  ).toBe(`url("${wallpaper}")`);
});

test("Display Properties is an XP dialog with What's This help", async () => {
  const h = await open();
  const { s, q } = h;
  const win = h.d.closest(".xp-window");
  expect(win.classList.contains("dialog-frame")).toBeTrue();
  expect(
    [...win.querySelectorAll(".title-buttons .tb-btn")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Help", "Close"]);
  win.querySelector(".help-btn").click();
  q("#display-theme").dispatchEvent(
    new s.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  expect(s.document.querySelector(".xp-help-popup").textContent).toContain(
    "Lists the themes you can use.",
  );
});

test("Windows and buttons switches between XP and Classic color schemes", async () => {
  const h = await open();
  const { q, change } = h;
  const schemes = () =>
    [...q("#display-appearance").options]
      .filter((option) => !option.hidden)
      .map((option) => option.textContent);
  expect(schemes()).toEqual(["Default (blue)", "Olive Green", "Silver"]);
  expect(q(".appearance-preview").dataset.schemePreview).toBe("blue");
  change("#display-appearance", "olive");
  expect(q(".appearance-preview").dataset.schemePreview).toBe("olive");
  expect(q(".display-theme-sample").dataset.schemePreview).toBe("olive");
  change("#display-window-style", "classic");
  expect(schemes()).toEqual(["Windows Standard"]);
  expect(q("#display-appearance").value).toBe("classic");
  change("#display-window-style", "xp");
  expect(q("#display-appearance").value).toBe("blue");
  expect(q('[data-display-action="apply"]').disabled).toBeTrue();
  change("#display-window-style", "classic");
  q('[data-display-action="apply"]').click();
  expect(h.saved().appearance).toBe("classic");
});

test("the Wait up-down steps the minutes within XP's range", async () => {
  const h = await open();
  const { q, change } = h;
  const spin = (step) => q(`.display-saver-spin [data-step="${step}"]`).click();
  change("#display-saver-wait", "59");
  spin(1);
  spin(1);
  expect(q("#display-saver-wait").value).toBe("60");
  change("#display-saver-wait", "2");
  spin(-1);
  spin(-1);
  expect(q("#display-saver-wait").value).toBe("1");
  q(".display-saver-spin").click();
  expect(q("#display-saver-wait").value).toBe("1");
});

test("Color quality names the screen's real color depth", async () => {
  for (const [depth, label] of [
    [24, "High (24 bit)"],
    [32, "Highest (32 bit)"],
  ]) {
    const s = await login(await loadShell());
    Object.defineProperty(s.window.screen, "colorDepth", {
      configurable: true,
      value: depth,
    });
    clickStartAction(s, "controlPanel");
    s.document
      .querySelector('[data-control-panel-category="appearance"]')
      .click();
    s.document.querySelector('[data-control-panel-action="display"]').click();
    expect(s.document.querySelector("#display-color-quality").textContent).toBe(
      label,
    );
    cleanupShells();
  }
});

test("Browse offers the browser picker the same picture types it lists", async () => {
  const h = await open();
  expect(h.q("#display-image").accept).toBe(
    "image/png,image/jpeg,image/gif,image/webp",
  );
});

test("another app's open dialog does not keep Display Properties inactive", async () => {
  const h = await open();
  const { s, q } = h;
  const owner = h.d.closest(".xp-window");
  q(".display-effects").click();
  const effects = s.document.querySelector(".display-effects-dialog");
  expect(owner.classList.contains("active")).toBeFalse();
  // A dialog from elsewhere in the shell opens over the Effects dialog.
  s.window.XPDialogs.alert("Elsewhere", "Other app");
  h.dialogButton(effects, "Cancel");
  expect(owner.classList.contains("active")).toBeTrue();
});

test("Desktop Items keeps the owner inactive until it closes", async () => {
  const h = await open();
  const { s, q } = h;
  const owner = h.d.closest(".xp-window");
  q(".display-customize").click();
  expect(owner.classList.contains("active")).toBeFalse();
  h.dialogButton(s.document.querySelector(".desktop-items-dialog"), "Cancel");
  expect(owner.classList.contains("active")).toBeTrue();
});
