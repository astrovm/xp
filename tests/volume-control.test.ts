// @ts-nocheck -- Volume Control's mixer through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";

afterEach(cleanupShells);

const settle = async () => {
  await flushShell();
  await flushShell();
};
const openVolumeControl = async (s) => {
  s.document
    .getElementById("tray-volume-button")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await settle();
  return s.document.querySelector('.xp-window[data-game="__volume-control"]');
};
const control = (win, line, name) =>
  win.querySelector(`[data-line="${line}"] .xp-mixer-${name}`);
const slide = (s, input, value) => {
  input.value = String(value);
  input.dispatchEvent(new s.window.Event("input", { bubbles: true }));
};
const toggle = (s, win, line) => {
  const box = win.querySelector(`[data-line="${line}"] [type="checkbox"]`);
  box.checked = !box.checked;
  box.dispatchEvent(new s.window.Event("change", { bubbles: true }));
};
const menu = async (win, name, command) => {
  win.querySelector(`[data-tm-menu="${name}"]`).click();
  const item = win.querySelector(`.tm-menu [data-command="${command}"]`);
  if (!item.disabled) item.click();
  await settle();
  return item;
};
const mixer = (s) => JSON.parse(s.window.localStorage.getItem("mixer"));

test("Volume Control's Wave fader and mute scale every sound after Master", async () => {
  const sounds = [];
  const s = await login(
    await loadShell({
      initialStorage: { volume: "80", mixer: JSON.stringify({ wave: "x" }) },
    }),
  );
  s.window.Audio = function Audio() {
    const audio = { volume: 1, play: () => Promise.resolve() };
    sounds.push(audio);
    return audio;
  };
  const win = await openVolumeControl(s);
  // XP names the window and first column after the master line.
  expect(win.querySelector(".xp-mixer-line h2").textContent).toBe(
    "Master Volume",
  );
  expect(win.querySelector(".title-text").textContent).toBe("Master Volume");
  expect(win.querySelector(".xp-mixer-status").textContent).toBe(
    "Intel(r) Integrated Audio",
  );
  expect(control(win, "wave", "volume").value).toBe("0");
  slide(s, control(win, "wave", "volume"), 50);
  expect(mixer(s).wave).toBe(50);

  toggle(s, win, "wave");
  expect(mixer(s).waveMuted).toBeTrue();
  toggle(s, win, "wave");

  // The tray and Volume Control stay in step.
  const tray = s.document.getElementById("tray-volume-slider");
  slide(s, tray, 30);
  expect(control(win, "master", "volume").value).toBe("30");
  slide(s, control(win, "master", "volume"), 60);
  expect(tray.value).toBe("60");
  toggle(s, win, "master");
  expect(s.window.localStorage.getItem("isMuted")).toBe("true");
  toggle(s, win, "master");

  // Close and confirm the window stops listening.
  await menu(win, "options", "exit");
  expect(
    s.document.querySelector('.xp-window[data-game="__volume-control"]'),
  ).toBeNull();
  slide(s, tray, 20);

  // Shell sounds play at Master × Wave: 20% × 50%.
  s.document.getElementById("start-button").click();
  s.document.getElementById("log-off-button").click();
  s.document.getElementById("switch-user-confirm").click();
  await settle();
  expect(sounds.at(-1).volume).toBeCloseTo(0.1);
});

test("Balance pans shell sounds through Web Audio", async () => {
  const pans = [];
  const s = await login(
    await loadShell({
      beforeScripts: (window) => {
        window.AudioContext = class {
          destination = {};
          createMediaElementSource() {
            return { connect: (node) => node };
          }
        };
        window.StereoPannerNode = class {
          constructor(_context, { pan }) {
            pans.push(pan);
          }
          connect(node) {
            return node;
          }
        };
      },
    }),
  );
  s.window.Audio = function Audio() {
    return { volume: 1, play: () => Promise.resolve() };
  };
  const win = await openVolumeControl(s);
  slide(s, control(win, "master", "balance"), -75);
  slide(s, control(win, "wave", "balance"), -50);
  expect(mixer(s)).toEqual(
    expect.objectContaining({ masterBalance: -75, waveBalance: -50 }),
  );
  // Logging off plays the log off sound, panned fully left.
  s.document.getElementById("start-button").click();
  s.document.getElementById("log-off-button").click();
  s.document.getElementById("switch-user-confirm").click();
  await settle();
  expect(pans).toEqual([-1]);
});

test("Volume Control's menus hide Wave, keep Advanced Controls gray and show About", async () => {
  const s = await login(await loadShell());
  const win = await openVolumeControl(s);
  const advanced = await menu(win, "options", "advanced");
  expect(advanced.disabled).toBeTrue();
  win.querySelector('[data-tm-menu="options"]').click();
  expect(win.querySelector(".tm-menu")).toBeNull();

  const properties = async (show, action) => {
    await menu(win, "options", "properties");
    const dialog = s.document.querySelector(".xp-mixer-properties");
    const box = dialog.querySelector('[data-mixer-show="wave"]');
    box.checked = show;
    dialog.querySelector(`[data-action="${action}"]`).click();
    await settle();
  };
  await properties(false, "cancel");
  expect(win.querySelector('[data-line="wave"]').hidden).toBeFalse();
  await properties(false, "ok");
  expect(win.querySelector('[data-line="wave"]').hidden).toBeTrue();
  expect(win.style.width).toBe("145px");
  expect(win.querySelector(".xp-native-volume").className).toContain(
    "xp-mixer-single",
  );
  await properties(true, "ok");
  expect(win.querySelector('[data-line="wave"]').hidden).toBeFalse();

  await menu(win, "help", "about");
  const about = s.document.querySelector(".about-windows-dialog");
  expect(about.querySelector(".title-text").textContent).toBe(
    "About Volume Control",
  );
  expect(about.querySelector(".about-windows-icon").src).toContain(
    "volume-32.png",
  );
});

test("Volume Control's menus follow XP's menu bar rules", async () => {
  const s = await login(await loadShell());
  const win = await openVolumeControl(s);
  await checkMenuBar({
    s,
    win,
    control: control(win, "master", "volume"),
    accessKey: "p",
    settle,
  });
});

test("Volume Control's menus give the keys to the frame when no control had them", async () => {
  const s = await login(await loadShell());
  const win = await openVolumeControl(s);
  const title = win.querySelector('[data-tm-menu="options"]');
  const slider = control(win, "master", "volume");
  slider.focus();
  // A menu title is not the window's control: the window keeps the slider.
  title.focus();
  expect(win.lastFocusedElement === slider).toBeTrue();
  // The pointer on a gray item leaves the keys where they are.
  slider.focus();
  slider.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "p",
      altKey: true,
      bubbles: true,
    }),
  );
  const properties = s.document.activeElement;
  expect(properties.dataset.command).toBe("properties");
  win
    .querySelector('[data-command="advanced"]')
    .dispatchEvent(new s.window.PointerEvent("pointerover", { bubbles: true }));
  expect(s.document.activeElement === properties).toBeTrue();
  properties.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(s.document.activeElement === title).toBeTrue();
  // Keys that no control had go to the frame, never to the page.
  slider.remove();
  title.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(s.document.activeElement === win).toBeTrue();
});
