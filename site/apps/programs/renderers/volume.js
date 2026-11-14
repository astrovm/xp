import { wireMenuBar } from "../../core/menu-bar.js";
import { createProgramRoot } from "../ui.js";

// sndvol32's mixer, laid out as XP SP3 shows it with the reference VM's
// Intel AC97 audio: a Master Volume column and a column per playback line.
// Every shell sound plays through Wave.
const DEVICE = "Intel(r) Integrated Audio";
// Window sizes with and without the Wave column.
const SIZES = { both: [247, 302], master: [145, 302] };
const MENUS = [
  [
    "O&ptions",
    [
      ["P&roperties", "properties"],
      ["&Advanced Controls", "advanced"],
      "-",
      ["E&xit", "exit"],
    ],
  ],
  ["&Help", [["&About Volume Control", "about"]]],
];

const line = (id, title, muteLabel) => `
  <section class="xp-mixer-line" data-line="${id}">
    <h2>${title}</h2>
    <span class="xp-mixer-caption">Balance:</span>
    <img class="xp-mixer-left" src="assets/xp/volume/balance-left.png" alt="">
    <input class="xp-mixer-balance" type="range" min="-100" max="100" aria-label="${title} balance">
    <img class="xp-mixer-right" src="assets/xp/volume/balance-right.png" alt="">
    <span class="xp-mixer-caption xp-mixer-volume-caption">Volume:</span>
    <span class="xp-mixer-ticks" aria-hidden="true"></span>
    <input class="xp-mixer-volume" type="range" min="0" max="100" aria-label="${title} volume">
    <label class="xp-mixer-mute"><input type="checkbox"><span>${muteLabel}</span></label>
  </section>`;

export const renderVolume = (context) => {
  const content = createProgramRoot({ kind: "volume" });
  content.innerHTML = `
    <div class="tm-menu-bar" role="menubar"></div>
    <div class="xp-mixer-lines">
      ${line("master", "Master Volume", "<u>M</u>ute all")}
      ${line("wave", "Wave", "<u>M</u>ute")}
    </div>
    <div class="xp-mixer-status"><span>${DEVICE}</span></div>`;
  // XP titles the window with the master line's name.
  context.setTitle("Master Volume");
  const [master, wave] = content.querySelectorAll(".xp-mixer-line");
  const controls = (section) => ({
    balance: section.querySelector(".xp-mixer-balance"),
    volume: section.querySelector(".xp-mixer-volume"),
    mute: section.querySelector('[type="checkbox"]'),
  });
  const masterControls = controls(master);
  const waveControls = controls(wave);

  const sync = () => {
    const { volume, isMuted } = context.getSystemVolume();
    const mixer = context.getMixer();
    masterControls.volume.value = String(volume);
    masterControls.mute.checked = isMuted;
    masterControls.balance.value = String(mixer.masterBalance);
    waveControls.volume.value = String(mixer.wave);
    waveControls.mute.checked = mixer.waveMuted;
    waveControls.balance.value = String(mixer.waveBalance);
    wave.hidden = !mixer.showWave;
    content.classList.toggle("xp-mixer-single", !mixer.showWave);
    context.setSize(...SIZES[mixer.showWave ? "both" : "master"]);
  };
  window.addEventListener("xp-volume-change", sync);

  const applyMaster = () =>
    context.setSystemVolume(
      Number(masterControls.volume.value),
      masterControls.mute.checked,
    );
  masterControls.volume.addEventListener("input", applyMaster);
  masterControls.mute.addEventListener("change", applyMaster);
  masterControls.balance.addEventListener("input", () =>
    context.setMixer({ masterBalance: Number(masterControls.balance.value) }),
  );
  waveControls.volume.addEventListener("input", () =>
    context.setMixer({ wave: Number(waveControls.volume.value) }),
  );
  waveControls.mute.addEventListener("change", () =>
    context.setMixer({ waveMuted: waveControls.mute.checked }),
  );
  waveControls.balance.addEventListener("input", () =>
    context.setMixer({ waveBalance: Number(waveControls.balance.value) }),
  );

  // Properties chooses which playback controls show, like XP's list.
  const openProperties = () => {
    const dialog = context.dialogs.createDialog({ title: "Properties" });
    dialog.el.classList.add("xp-mixer-properties");
    dialog.body.innerHTML = `
      <label class="xp-mixer-device">Mixer device: <select disabled><option>${DEVICE}</option></select></label>
      <fieldset class="dlg-group"><legend>Adjust volume for</legend>
        <label><input type="radio" name="xp-mixer-adjust" checked> <u>P</u>layback</label>
        <label><input type="radio" name="xp-mixer-adjust" disabled> <u>R</u>ecording</label>
      </fieldset>
      <p>Show the following volume controls:</p>
      <div class="xp-mixer-controls">
        <label><input type="checkbox" checked disabled> Volume Control</label>
        <label><input type="checkbox" data-mixer-show="wave"> Wave</label>
      </div>`;
    const showWave = dialog.body.querySelector('[data-mixer-show="wave"]');
    showWave.checked = context.getMixer().showWave;
    dialog.onResult((choice) => {
      if (choice === "ok") context.setMixer({ showWave: showWave.checked });
    });
    context.dialogs.addButtonRow(dialog, [
      { id: "ok", label: "OK", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ]);
  };
  const commands = {
    properties: openProperties,
    exit: () => context.close(),
    about: () =>
      context.openAboutWindows({
        application: "Volume Control",
        icon: "assets/xp/volume/volume-32.png",
      }),
  };

  // Menus, styled like Task Manager's. Advanced Controls stays gray: the
  // device has no tone controls.
  const menuBar = content.querySelector(".tm-menu-bar");
  const menuItems = new Map();
  const menus = wireMenuBar({
    windowElement: context.windowElement,
    bar: menuBar,
    showMenu: (button) => {
      const menu = document.createElement("div");
      menu.className = "tm-menu";
      menu.setAttribute("role", "menu");
      menu.style.left = `${button.offsetLeft}px`;
      menuItems.get(button).forEach((item) => {
        if (item === "-") {
          menu.insertAdjacentHTML(
            "beforeend",
            '<div class="tm-menu-separator"></div>',
          );
          return;
        }
        const [itemLabel, command] = item;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.setAttribute("role", "menuitem");
        entry.dataset.command = command;
        entry.disabled = command === "advanced";
        const text = document.createElement("span");
        context.setAccessKeyText(text, itemLabel);
        entry.append(text, document.createElement("kbd"));
        entry.addEventListener("click", () => {
          menus.close();
          commands[command]();
        });
        menu.append(entry);
      });
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => menu.remove(),
  });
  MENUS.forEach(([label, items]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.tmMenu = label.replace(/&/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuItems.set(button, items);
    menuBar.append(button);
  });

  sync();
  return {
    element: content,
    unmount: () => window.removeEventListener("xp-volume-change", sync),
  };
};
