"use strict";

// ============================================
// System Tray
// ============================================

const getSystemVolume = () => {
  // A corrupted stored level must not reach HTMLMediaElement.volume, which
  // throws for non-finite values and would stop the startup sound and boot.
  const volume = parseInt(localStorage.getItem("volume") || "100", 10);
  return {
    volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 100) : 100,
    isMuted: localStorage.getItem("isMuted") === "true",
  };
};

// Volume Control's other settings. Every sound in the shell plays through
// Wave, so its level and mute scale everything after Master's.
const MIXER_KEY = "mixer";
const DEFAULT_MIXER = Object.freeze({
  masterBalance: 0,
  wave: 100,
  waveMuted: false,
  waveBalance: 0,
  showWave: true,
});
const getMixer = () => {
  const mixer = { ...DEFAULT_MIXER, ...readJsonStorage(MIXER_KEY, {}) };
  const level = (value, low) =>
    Number.isFinite(value) ? Math.min(Math.max(value, low), 100) : 0;
  return {
    masterBalance: level(mixer.masterBalance, -100),
    wave: level(mixer.wave, 0),
    waveMuted: mixer.waveMuted === true,
    waveBalance: level(mixer.waveBalance, -100),
    showWave: mixer.showWave !== false,
  };
};
const setMixer = (changes) => {
  localStorage.setItem(
    MIXER_KEY,
    JSON.stringify({ ...getMixer(), ...changes }),
  );
  applyFocusVolumes();
  window.dispatchEvent(new Event("xp-volume-change"));
};
// The share of full volume that reaches the speakers, from 0 to 1.
const getAudioLevel = () => {
  const { volume, isMuted } = getSystemVolume();
  const { wave, waveMuted } = getMixer();
  return isMuted || waveMuted ? 0 : (volume / 100) * (wave / 100);
};
// Master and Wave balance add up, from -1 (left) to 1 (right).
const getAudioBalance = () => {
  const { masterBalance, waveBalance } = getMixer();
  return Math.min(Math.max((masterBalance + waveBalance) / 100, -1), 1);
};

const syncTrayVolumeUI = () => {
  const { volume, isMuted } = getSystemVolume();
  const button = document.getElementById("tray-volume-button");
  const slider = document.getElementById("tray-volume-slider");
  const muteBox = document.getElementById("tray-mute-checkbox");
  button.classList.toggle("muted", isMuted || volume === 0);
  button.title = isMuted ? "Volume (muted)" : "Volume";
  slider.value = String(volume);
  muteBox.checked = isMuted;
};

const setSystemVolume = (volume, isMuted) => {
  // Like the real XP Volume Control's Master fader, this scales every
  // audio source - games included - on top of each game's own volume
  // (see getGameVolume/setGameVolume, normalizeGameVolume), rather than
  // being a separate, unrelated channel.
  localStorage.setItem("volume", String(volume));
  localStorage.setItem("isMuted", String(isMuted));
  applyFocusVolumes();
  syncTrayVolumeUI();
  window.dispatchEvent(new Event("xp-volume-change"));
};

// Programs add their icons left of the existing ones, like XP. Double-click,
// or Enter on the focused icon, opens the program.
const addTrayIcon = (label, onOpen) => {
  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = "tray-icon";
  icon.setAttribute("aria-label", label);
  icon.addEventListener("dblclick", onOpen);
  icon.addEventListener("click", (event) => {
    if (event.detail === 0) onOpen();
  });
  document.getElementById("tray-volume-button").before(icon);
  return icon;
};

const closeTrayVolumePopup = () => {
  const popup = document.getElementById("tray-volume-popup");
  const button = document.getElementById("tray-volume-button");
  popup.hidden = true;
  button.classList.remove("pressed");
  button.setAttribute("aria-expanded", "false");
};

const openTrayVolumePopup = () => {
  const popup = document.getElementById("tray-volume-popup");
  const button = document.getElementById("tray-volume-button");
  syncTrayVolumeUI();
  popup.hidden = false;
  button.classList.add("pressed");
  button.setAttribute("aria-expanded", "true");
  const rect = button.getBoundingClientRect();
  const left = Math.max(
    4,
    Math.min(
      rect.left + rect.width / 2 - popup.offsetWidth / 2,
      getViewportWidth() - popup.offsetWidth - 4,
    ),
  );
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(0, Math.min(getTaskbarSettings().edge === "top" ? rect.bottom + 4 : rect.top - popup.offsetHeight - 4, getViewportHeight() - popup.offsetHeight))}px`;
  document.getElementById("tray-volume-slider").focus();
};

const toggleTrayVolumePopup = () => {
  if (document.getElementById("tray-volume-popup").hidden) {
    openTrayVolumePopup();
  } else {
    closeTrayVolumePopup();
  }
};

const offlineStatusText = (state) => {
  const messages = {
    starting: "Getting files ready...",
    downloading: "Downloading...",
    checking: "Checking for updates...",
    updating: "Downloading the update...",
    "repair-required": "The update didn't finish. Select Repair.",
    applying: "Restarting...",
    repairing: "Repairing...",
    error: "Some files are missing. Select Repair.",
  };
  const message = messages[state.phase] || "";
  return state.error ? `${message} ${state.error}` : message;
};

const formatUpdateCheckTime = (timestamp) =>
  timestamp ? new Date(timestamp).toLocaleString() : "Never";

const UPDATE_DELAY_HOUR = 60 * 60 * 1000;
const formatAutomaticUpdateDelay = (delayMs) => {
  const hours = Math.round(delayMs / UPDATE_DELAY_HOUR);
  if (hours === 0) return "No delay";
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return [
    days ? `${days} ${days === 1 ? "day" : "days"}` : "",
    remainingHours
      ? `${remainingHours} ${remainingHours === 1 ? "hour" : "hours"}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const formatProjectBytes = (bytes) =>
  XPDialogs.formatBytes(bytes).replace(/\s+\([^)]*\)$/, "");

const projectStorageText = (state) => {
  if (state.usage === null) return "Unavailable";
  return formatProjectBytes(state.usage);
};

// A newer release removed a file this tab needs. Asked once per tab.
let reloadPromptShown = false;
const promptReloadForUpdate = async (state) => {
  if (!state.reloadRequired || reloadPromptShown) return;
  reloadPromptShown = true;
  const choice = await XPDialogs.message({
    title: "Astro XP Update",
    text: "A new version of Astro XP is out, so some files this page needs are gone.\n\nReload to update. Save your work first.",
    icon: "info",
    buttons: [
      { id: "reload", label: "&Reload", isDefault: true },
      { id: "later", label: "&Later", isCancel: true },
    ],
  });
  if (choice !== "reload") return;
  if (offlineManager.getSnapshot().enabled) {
    offlineManager.updateNow().catch(() => window.location.reload());
  } else {
    window.location.reload();
  }
};

// Runs once at startup. The development server serves no service worker.
const initializeOfflineMode = () => {
  if (window.ASTRO_DEV) return offlineManagerInitialization;
  offlineManager.subscribe((state) => void promptReloadForUpdate(state));
  offlineManagerInitialization = offlineManager.initialize().catch((error) => {
    console.error("Offline mode initialization failed:", error);
    throw error;
  });
  return offlineManagerInitialization;
};

const saveBundledGameForOffline = (gameId) => {
  if (window.ASTRO_DEV || navigator.onLine === false) {
    return;
  }

  // Each queued download handles its own failure, so the queue never rejects.
  automaticOfflineDownloadQueue = automaticOfflineDownloadQueue
    .then(async () => {
      await offlineManagerInitialization;
      const snapshot = offlineManager.getSnapshot();
      if (!snapshot.enabled || !snapshot.savePlayedGamesOffline) return;
      if (!snapshot.bundledGames.some((game) => game.id === gameId)) {
        return;
      }
      if (snapshot.downloadedGameIds.includes(gameId)) {
        return;
      }
      await offlineManager.downloadGame(gameId);
    })
    .catch((error) => {
      console.warn(
        "Could not save game for offline play:",
        formatGameTitle(gameId),
        error,
      );
    });
};

const wireProjectSettings = (win) => {
  const content = win.el.querySelector(".project-settings-content");
  const bundledGameCount = Object.keys(window.FLASH_GAMES).length;
  content.innerHTML = `
    <div class="project-settings-tabs" role="tablist" aria-label="Astro XP Settings">
      <button type="button" role="tab" class="active" id="project-tab-general" aria-controls="project-panel-general" aria-selected="true">General</button>
      <button type="button" role="tab" id="project-tab-games" aria-controls="project-panel-games" aria-selected="false" tabindex="-1">Games</button>
      <button type="button" role="tab" id="project-tab-updates" aria-controls="project-panel-updates" aria-selected="false" tabindex="-1">Updates</button>
      <button type="button" role="tab" id="project-tab-recovery" aria-controls="project-panel-recovery" aria-selected="false" tabindex="-1">Recovery</button>
    </div>
    <section class="project-settings-panel active" id="project-panel-general" role="tabpanel" aria-labelledby="project-tab-general">
      <div class="project-settings-product">
        <img src="assets/xp/icons/ControlPanel.png" alt="">
        <div>
          <h2>Astro XP</h2>
          <p data-project-value="connection"></p>
        </div>
      </div>
      <fieldset>
        <legend>Offline</legend>
        <label class="project-offline-setting"><input type="checkbox" data-project-setting="offline-enabled" checked> Use Astro XP offline</label>
        <dl class="dlg-props-table project-settings-details">
          <dt>Status:</dt><dd data-project-value="offlineFiles"></dd>
          <dt>Size:</dt><dd data-project-value="downloadSize"></dd>
          <dt>Storage used:</dt><dd data-project-value="storage"></dd>
        </dl>
      </fieldset>
      <fieldset>
        <legend>Startup</legend>
        <label class="project-offline-setting"><input type="checkbox" data-project-setting="full-startup"> Always show the full startup</label>
        <label class="project-offline-setting"><input type="checkbox" data-project-setting="startup-sound"> Play the startup sound</label>
        <label class="project-settings-slider">Volume: <output data-project-value="startup-sound-volume"></output>
          <input type="range" min="0" max="100" step="5" data-project-setting="startup-sound-volume">
          <span><span>Low</span><span>High</span></span>
        </label>
      </fieldset>
      <a class="project-suggestions-link" href="https://github.com/astrovm/xp/issues" target="_blank" rel="noopener noreferrer">Send feedback</a>
    </section>
    <section class="project-settings-panel" id="project-panel-games" role="tabpanel" aria-labelledby="project-tab-games" hidden>
      <fieldset>
        <legend>Offline games</legend>
        <label class="project-offline-setting"><input type="checkbox" data-project-setting="save-played-games" checked> Save games I play for offline use</label>
        <p><span data-project-value="offlineGames"></span> saved<span data-project-value="offlineGameStorage"></span></p>
        <div class="project-offline-game-list" data-project-offline-games role="group" aria-label="Offline games"></div>
        <progress class="project-settings-progress" data-project-game-progress aria-label="Game download progress" hidden></progress>
        <p class="project-settings-status" data-project-status="offline-games" aria-live="polite"></p>
        <div class="project-settings-actions">
          <button type="button" class="xp-btn" data-project-action="download-all-games">Save All</button>
          <button type="button" class="xp-btn" data-project-action="remove-all-games">Remove All</button>
        </div>
      </fieldset>
      <fieldset data-project-game-data-group hidden>
        <legend>Installed games</legend>
        <div class="project-game-data-list" data-project-game-data aria-live="polite"></div>
        <p class="project-settings-status" data-project-status="game-data" aria-live="polite"></p>
      </fieldset>
    </section>
    <section class="project-settings-panel" id="project-panel-updates" role="tabpanel" aria-labelledby="project-tab-updates" hidden>
      <fieldset>
        <legend>Automatic updates</legend>
        <label class="project-offline-setting"><input type="checkbox" data-project-setting="automatic-updates" checked> Update automatically</label>
        <label class="project-settings-slider">Wait: <output data-project-value="update-delay">6 hours</output>
          <input type="range" min="0" max="72" step="1" value="6" data-project-setting="update-delay">
          <span><span>Now</span><span>3 days</span></span>
        </label>
        <p class="project-settings-description">Updates open on your next visit.</p>
      </fieldset>
      <fieldset>
        <legend>Version</legend>
        <dl class="dlg-props-table project-settings-details">
          <dt>Installed:</dt><dd data-project-value="version"></dd>
          <dt>Available:</dt><dd data-project-value="availableVersion"></dd>
          <dt>Last checked:</dt><dd data-project-value="lastChecked"></dd>
        </dl>
        <p class="project-settings-status" data-project-status="updates" aria-live="polite"></p>
        <progress class="project-settings-progress" data-project-update-progress aria-label="Update download progress" hidden></progress>
        <div class="project-settings-actions">
          <button type="button" class="xp-btn" data-project-action="update-now">Update Now</button>
          <button type="button" class="xp-btn" data-project-action="check">Check Now</button>
        </div>
      </fieldset>
    </section>
    <section class="project-settings-panel" id="project-panel-recovery" role="tabpanel" aria-labelledby="project-tab-recovery" hidden>
      <fieldset class="project-recovery-group">
        <legend>Repair</legend>
        <p>Download the system files again. Your games and files stay.</p>
        <p class="project-settings-status" data-project-status="offline" aria-live="polite"></p>
        <button type="button" class="xp-btn" data-project-action="repair">Repair</button>
      </fieldset>
      <fieldset class="project-recovery-group">
        <legend>Desktop</legend>
        <p>Put every game shortcut back in its place. Nothing else changes.</p>
        <button type="button" class="xp-btn" data-project-action="restore-desktop">Restore Desktop</button>
      </fieldset>
      <fieldset class="project-recovery-group">
        <legend>Reset</legend>
        <p>Delete your files and settings. Games stay.</p>
        <button type="button" class="xp-btn" data-project-action="reset">Reset</button>
      </fieldset>
    </section>
  `;

  const tabs = [...content.querySelectorAll('[role="tab"]')];
  const panels = [...content.querySelectorAll('[role="tabpanel"]')];
  const value = (name) =>
    content.querySelector(`[data-project-value="${name}"]`);
  const offlineStatus = content.querySelector(
    '[data-project-status="offline"]',
  );
  const offlineGamesStatus = content.querySelector(
    '[data-project-status="offline-games"]',
  );
  const offlineGamesList = content.querySelector(
    "[data-project-offline-games]",
  );
  const updateStatus = content.querySelector('[data-project-status="updates"]');
  const gameDataList = content.querySelector("[data-project-game-data]");
  const gameDataGroup = content.querySelector("[data-project-game-data-group]");
  const gameDataStatus = content.querySelector(
    '[data-project-status="game-data"]',
  );
  const downloadProgress = content.querySelector(
    "[data-project-update-progress]",
  );
  const gameDownloadProgress = content.querySelector(
    "[data-project-game-progress]",
  );
  const checkButton = content.querySelector('[data-project-action="check"]');
  const updateNowButton = content.querySelector(
    '[data-project-action="update-now"]',
  );
  const updateDelayInput = content.querySelector(
    '[data-project-setting="update-delay"]',
  );
  const updateDelayOutput = value("update-delay");
  const offlineEnabledCheckbox = content.querySelector(
    '[data-project-setting="offline-enabled"]',
  );
  const savePlayedGamesCheckbox = content.querySelector(
    '[data-project-setting="save-played-games"]',
  );
  const fullStartupCheckbox = content.querySelector(
    '[data-project-setting="full-startup"]',
  );
  fullStartupCheckbox.checked = readStartupFlag(FULL_STARTUP_KEY);
  fullStartupCheckbox.addEventListener("change", () => {
    setStartupFlag(FULL_STARTUP_KEY, fullStartupCheckbox.checked);
  });
  const startupSoundCheckbox = content.querySelector(
    '[data-project-setting="startup-sound"]',
  );
  const startupSoundVolumeInput = content.querySelector(
    '[data-project-setting="startup-sound-volume"]',
  );
  const startupSoundVolumeOutput = value("startup-sound-volume");
  const renderStartupSound = () => {
    const { enabled, volume } = getStartupSound();
    startupSoundCheckbox.checked = enabled;
    startupSoundVolumeInput.disabled = !enabled;
    startupSoundVolumeInput.value = String(volume);
    startupSoundVolumeOutput.value = `${volume}%`;
  };
  renderStartupSound();
  startupSoundCheckbox.addEventListener("change", () => {
    setStartupSound({ enabled: startupSoundCheckbox.checked });
    renderStartupSound();
  });
  startupSoundVolumeInput.addEventListener("input", () => {
    startupSoundVolumeOutput.value = `${startupSoundVolumeInput.value}%`;
  });
  startupSoundVolumeInput.addEventListener("change", () => {
    setStartupSound({ volume: Number(startupSoundVolumeInput.value) });
    renderStartupSound();
  });
  const automaticUpdatesCheckbox = content.querySelector(
    '[data-project-setting="automatic-updates"]',
  );
  const repairButton = content.querySelector('[data-project-action="repair"]');
  const downloadAllGamesButton = content.querySelector(
    '[data-project-action="download-all-games"]',
  );
  const removeAllGamesButton = content.querySelector(
    '[data-project-action="remove-all-games"]',
  );
  const restoreDesktopButton = content.querySelector(
    '[data-project-action="restore-desktop"]',
  );
  const resetButton = content.querySelector('[data-project-action="reset"]');

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
    if (panelId === "project-panel-games") void renderGameData();
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

  const transientPhases = new Set([
    "starting",
    "downloading",
    "checking",
    "updating",
    "applying",
    "repairing",
    "disabling",
  ]);
  let offlineListSignature = "";
  let gameDataRefresh = 0;
  const renderGameData = async () => {
    const refresh = ++gameDataRefresh;
    gameDataStatus.textContent = "Checking...";
    try {
      const [internetGames, externalGames] = await Promise.all([
        gameLibrary?.getInstallations?.() || [],
        gameDataManager.list(),
      ]);
      if (refresh !== gameDataRefresh) return;
      const items = [
        ...internetGames.map((item) => ({
          ...item,
          detail: "Installed game",
          removeId: item.id,
          owner: "internet",
        })),
        ...externalGames.map((item) => ({
          ...item,
          removeId: item.id,
          owner: "external",
        })),
      ];
      gameDataList.replaceChildren();
      gameDataGroup.hidden = !items.length;
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "project-game-data";
        const text = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = item.title;
        const detail = document.createElement("small");
        detail.textContent = `${item.detail}, ${formatProjectBytes(item.bytes)}`;
        text.append(title, detail);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "xp-btn";
        remove.textContent = "Remove";
        remove.dataset.gameDataId = item.removeId;
        remove.dataset.gameDataOwner = item.owner;
        remove.dataset.gameDataTitle = item.title;
        row.append(text, remove);
        gameDataList.appendChild(row);
      });
      gameDataStatus.textContent = "";
    } catch (error) {
      if (refresh !== gameDataRefresh) return;
      gameDataStatus.textContent = error.message;
    }
  };

  gameDataList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-game-data-id]");
    if (!button) return;
    const accepted = await XPDialogs.confirm(
      `Remove ${button.dataset.gameDataTitle}?\n\nYour saves stay.`,
      "Remove Game",
      "question",
    );
    if (!accepted) return;
    button.disabled = true;
    gameDataStatus.textContent = "Removing...";
    try {
      if (button.dataset.gameDataOwner === "internet") {
        await gameLibrary.uninstall(button.dataset.gameDataId);
      } else {
        await gameDataManager.remove(button.dataset.gameDataId);
      }
      await offlineManager.refreshStorageEstimate();
      await renderGameData();
    } catch (error) {
      button.disabled = false;
      gameDataStatus.textContent = error.message;
    }
  });

  const renderOfflineGameList = (state) => {
    const downloaded = new Set(state.downloadedGameIds);
    const busy = ["downloading", "removing"].includes(state.gamePhase);
    const signature = JSON.stringify([
      state.bundledGames.map((game) => [
        game.id,
        game.bytes,
        downloaded.has(game.id),
      ]),
      busy,
      state.enabled,
      state.activeGameId,
    ]);
    if (signature === offlineListSignature) return;
    offlineListSignature = signature;
    offlineGamesList.replaceChildren();
    if (!state.bundledGames.length) {
      if (state.enabled) {
        const loading = document.createElement("p");
        loading.className = "project-settings-description";
        loading.textContent = "Loading...";
        offlineGamesList.appendChild(loading);
      }
      return;
    }
    const games = [...state.bundledGames].sort((left, right) => {
      const leftTitle = gamesList[left.id]?.title || formatGameTitle(left.id);
      const rightTitle =
        gamesList[right.id]?.title || formatGameTitle(right.id);
      return leftTitle.localeCompare(rightTitle);
    });
    games.forEach((game) => {
      const label = document.createElement("label");
      label.className = "project-offline-game";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = downloaded.has(game.id);
      checkbox.disabled = busy || !state.enabled;
      checkbox.dataset.offlineGame = game.id;
      const title = document.createElement("span");
      title.textContent = gamesList[game.id]?.title || formatGameTitle(game.id);
      const size = document.createElement("span");
      size.className = "project-offline-game-size";
      size.textContent = formatProjectBytes(game.bytes);
      label.append(checkbox, title, size);
      offlineGamesList.appendChild(label);
    });
  };

  offlineGamesList.addEventListener("change", (event) => {
    const control = event.target.closest("[data-offline-game]");
    if (!control) return;
    const action = control.checked
      ? offlineManager.downloadGame(control.dataset.offlineGame)
      : offlineManager.removeGame(control.dataset.offlineGame);
    action.catch((error) => {
      offlineGamesStatus.textContent = error.message;
    });
  });

  const render = (state) => {
    value("version").textContent = APP_VERSION;
    value("availableVersion").textContent = state.availableVersion
      ? state.availableVersion
      : state.lastChecked
        ? "None"
        : "Unknown";
    value("downloadSize").textContent =
      state.downloadBytes === null
        ? state.downloadMetadataError
          ? "Unavailable"
          : "Checking..."
        : formatProjectBytes(state.downloadBytes);
    value("connection").textContent = state.online ? "Online" : "Offline";
    value("offlineFiles").textContent = !state.enabled
      ? "Off"
      : state.workerState === "active"
        ? "Ready"
        : ["installing", "installed", "activating", "waiting"].includes(
              state.workerState,
            )
          ? "Getting ready..."
          : "Unavailable";
    value("offlineGames").textContent =
      `${state.downloadedGameIds.length} of ${state.bundledGames.length || bundledGameCount}`;
    value("offlineGameStorage").textContent = state.downloadedGameIds.length
      ? ` (${formatProjectBytes(state.downloadedGameBytes)})`
      : "";
    value("storage").textContent = projectStorageText(state);
    value("lastChecked").textContent = formatUpdateCheckTime(state.lastChecked);
    offlineStatus.textContent = state.enabled ? offlineStatusText(state) : "";
    const activeGameTitle = state.activeGameId
      ? gamesList[state.activeGameId]?.title ||
        formatGameTitle(state.activeGameId)
      : "games";
    offlineGamesStatus.textContent = state.gameError
      ? state.gameError
      : state.gamePhase === "downloading"
        ? `Downloading ${activeGameTitle}...`
        : state.gamePhase === "removing"
          ? "Removing..."
          : "";
    const updateStage = {
      starting: "Getting files ready...",
      checking: "Checking...",
      downloading: "Downloading. Keep this page open...",
      updating: "Downloading the update. Keep this page open...",
      applying: "Restarting...",
      repairing: "Repairing...",
    }[state.phase];
    updateStatus.textContent = !state.enabled
      ? ""
      : updateStage
        ? updateStage
        : state.phase === "update-pending" && state.automaticUpdatesEnabled
          ? `Updates on ${formatUpdateCheckTime(state.updateEligibleAt)}.`
          : state.updateReady
            ? `${state.availableVersion ? `Version ${state.availableVersion}` : "The update"} opens on your next visit.`
            : state.availableVersion
              ? `Version ${state.availableVersion} is available.`
              : state.lastChecked
                ? "Up to date."
                : "";
    if (state.error) {
      updateStatus.textContent = state.error;
    }
    updateNowButton.textContent = updateStage
      ? state.phase === "applying"
        ? "Reloading..."
        : "Please wait..."
      : "Update Now";
    downloadProgress.hidden = ![
      "checking",
      "applying",
      "starting",
      "downloading",
      "updating",
      "repairing",
    ].includes(state.phase);
    gameDownloadProgress.hidden = state.gamePhase !== "downloading";
    if (state.gameProgressTotal > 0) {
      gameDownloadProgress.max = state.gameProgressTotal;
      gameDownloadProgress.value = state.gameProgressLoaded;
    } else {
      gameDownloadProgress.removeAttribute("value");
    }
    const gameBusy = ["downloading", "removing"].includes(state.gamePhase);
    offlineEnabledCheckbox.checked = state.enabled;
    savePlayedGamesCheckbox.checked = state.savePlayedGamesOffline;
    automaticUpdatesCheckbox.checked = state.automaticUpdatesEnabled;
    offlineEnabledCheckbox.disabled =
      gameBusy || transientPhases.has(state.phase);
    savePlayedGamesCheckbox.disabled =
      !state.enabled || transientPhases.has(state.phase);
    automaticUpdatesCheckbox.disabled =
      !state.enabled || transientPhases.has(state.phase);
    checkButton.disabled =
      !state.enabled || !state.online || transientPhases.has(state.phase);
    updateNowButton.disabled =
      !state.enabled || !state.online || transientPhases.has(state.phase);
    updateDelayInput.disabled =
      !state.enabled ||
      !state.automaticUpdatesEnabled ||
      transientPhases.has(state.phase);
    const automaticUpdateDelay =
      state.automaticUpdateDelayMs ??
      state.releaseUpdateDelayMs ??
      6 * UPDATE_DELAY_HOUR;
    updateDelayInput.value = String(
      Math.min(
        72,
        Math.max(0, Math.round(automaticUpdateDelay / UPDATE_DELAY_HOUR)),
      ),
    );
    updateDelayOutput.value = formatAutomaticUpdateDelay(automaticUpdateDelay);
    repairButton.disabled =
      !state.enabled || !state.online || transientPhases.has(state.phase);
    downloadAllGamesButton.disabled =
      !state.online ||
      !state.enabled ||
      gameBusy ||
      !state.bundledGames.length ||
      state.downloadedGameIds.length === state.bundledGames.length;
    removeAllGamesButton.disabled =
      !state.enabled || gameBusy || state.downloadedGameIds.length === 0;
    renderOfflineGameList(state);
  };
  const unsubscribe = offlineManager.subscribe(render);
  const unsubscribeGames = gameLibrary?.subscribe(() => {
    render(offlineManager.getSnapshot());
    void offlineManager.refreshStorageEstimate();
    void renderGameData();
  });
  const refreshStoredGameData = (event) => {
    if (
      event.type === "storage" ||
      (event.origin === window.location.origin &&
        event.data?.event === "astro.game-data-changed")
    ) {
      void renderGameData();
    }
  };
  window.addEventListener("storage", refreshStoredGameData);
  window.addEventListener("message", refreshStoredGameData);
  win.beforeClose = () => {
    unsubscribe();
    unsubscribeGames?.();
    window.removeEventListener("storage", refreshStoredGameData);
    window.removeEventListener("message", refreshStoredGameData);
    return true;
  };

  checkButton.addEventListener("click", () => {
    offlineManager.checkForUpdates().catch(() => {});
  });
  updateNowButton.addEventListener("click", () => {
    offlineManager.updateNow().catch(() => {});
  });
  offlineEnabledCheckbox.addEventListener("change", async () => {
    if (!offlineEnabledCheckbox.checked) {
      const accepted = await XPDialogs.confirm(
        "Stop using Astro XP offline?\n\nThis removes the downloaded files and offline games. Your files, saves, settings and installed games stay.",
        "Turn Off Offline",
        "question",
      );
      if (!accepted) {
        offlineEnabledCheckbox.checked = true;
        return;
      }
    }
    offlineManager
      .setOfflineEnabled(offlineEnabledCheckbox.checked)
      .catch((error) => {
        offlineStatus.textContent = error.message;
      });
  });
  savePlayedGamesCheckbox.addEventListener("change", () => {
    offlineManager.setSavePlayedGamesOffline(savePlayedGamesCheckbox.checked);
  });
  automaticUpdatesCheckbox.addEventListener("change", () => {
    offlineManager.setAutomaticUpdatesEnabled(automaticUpdatesCheckbox.checked);
  });
  updateDelayInput.addEventListener("input", () => {
    updateDelayOutput.value = formatAutomaticUpdateDelay(
      Number(updateDelayInput.value) * UPDATE_DELAY_HOUR,
    );
  });
  updateDelayInput.addEventListener("change", () => {
    const delay = Number(updateDelayInput.value) * UPDATE_DELAY_HOUR;
    offlineManager.setAutomaticUpdateDelay(delay);
    if (offlineManager.getSnapshot().automaticUpdatesEnabled) {
      offlineManager
        .checkForUpdates({ applyAutomatically: true })
        .catch(() => {});
    }
  });
  repairButton.addEventListener("click", async () => {
    const accepted = await XPDialogs.confirm(
      "Download the system files again?",
      "Repair",
      "question",
    );
    if (!accepted) return;
    offlineManager.repair().catch((error) => {
      offlineStatus.textContent = error.message;
    });
  });
  downloadAllGamesButton.addEventListener("click", () => {
    offlineManager.downloadAllGames().catch((error) => {
      offlineGamesStatus.textContent = error.message;
    });
  });
  removeAllGamesButton.addEventListener("click", async () => {
    const accepted = await XPDialogs.confirm(
      "Remove all offline games?\n\nInstalled games stay.",
      "Remove All",
      "question",
    );
    if (!accepted) return;
    offlineManager.removeAllGames().catch((error) => {
      offlineGamesStatus.textContent = error.message;
    });
  });
  restoreDesktopButton.addEventListener("click", async () => {
    try {
      const accepted = await XPDialogs.confirm(
        "Put every game shortcut back in its place?\n\nYour files and settings stay.",
        "Restore Desktop",
        "question",
      );
      if (!accepted) return;
      await restoreDefaultDesktop();
      window.location.reload();
    } catch (error) {
      await XPDialogs.alert(
        error.message || "Something went wrong.",
        "Astro XP",
        "error",
      );
    }
  });
  resetButton.addEventListener("click", async () => {
    try {
      const accepted = await XPDialogs.confirm(
        "Delete your files and settings?\n\nThis can't be undone. Games stay.",
        "Reset",
        "warning",
      );
      if (!accepted) return;
      await resetAstroXp();
      window.location.reload();
    } catch (error) {
      await XPDialogs.alert(
        error.message || "Something went wrong.",
        "Astro XP",
        "error",
      );
    }
  });
};

const openProjectSettings = () => openSystemWindow("__astro-settings");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

// XP's Time Zone list, in its order. Offsets are standard time in minutes
// east of UTC; `zones` are IANA names used to recognize the host's zone.
const XP_TIME_ZONES = [
  ["Dateline", -720, "International Date Line West"],
  ["Samoa", -660, "Midway Island, Samoa", "Pacific/Pago_Pago"],
  ["Hawaiian", -600, "Hawaii", "Pacific/Honolulu"],
  ["Alaskan", -540, "Alaska", "America/Anchorage"],
  [
    "Pacific",
    -480,
    "Pacific Time (US & Canada); Tijuana",
    "America/Los_Angeles America/Vancouver America/Tijuana",
  ],
  ["US Mountain", -420, "Arizona", "America/Phoenix"],
  [
    "Mexico Standard Time 2",
    -420,
    "Chihuahua, La Paz, Mazatlan",
    "America/Chihuahua America/Mazatlan",
  ],
  [
    "Mountain",
    -420,
    "Mountain Time (US & Canada)",
    "America/Denver America/Edmonton",
  ],
  [
    "Central America",
    -360,
    "Central America",
    "America/Guatemala America/Costa_Rica",
  ],
  [
    "Central",
    -360,
    "Central Time (US & Canada)",
    "America/Chicago America/Winnipeg",
  ],
  [
    "Mexico",
    -360,
    "Guadalajara, Mexico City, Monterrey",
    "America/Mexico_City America/Monterrey",
  ],
  ["Canada Central", -360, "Saskatchewan", "America/Regina"],
  [
    "SA Pacific",
    -300,
    "Bogota, Lima, Quito",
    "America/Bogota America/Lima America/Guayaquil",
  ],
  [
    "Eastern",
    -300,
    "Eastern Time (US & Canada)",
    "America/New_York America/Toronto America/Detroit",
  ],
  ["US Eastern", -300, "Indiana (East)", "America/Indiana/Indianapolis"],
  ["Atlantic", -240, "Atlantic Time (Canada)", "America/Halifax"],
  ["SA Western", -240, "Caracas, La Paz", "America/Caracas America/La_Paz"],
  ["Pacific SA", -240, "Santiago", "America/Santiago"],
  ["Newfoundland", -210, "Newfoundland", "America/St_Johns"],
  ["E. South America", -180, "Brasilia", "America/Sao_Paulo"],
  [
    "SA Eastern",
    -180,
    "Buenos Aires, Georgetown",
    "America/Buenos_Aires America/Argentina/Buenos_Aires America/Argentina/Cordoba America/Guyana",
  ],
  ["Greenland", -180, "Greenland", "America/Godthab America/Nuuk"],
  ["Mid-Atlantic", -120, "Mid-Atlantic", "Atlantic/South_Georgia"],
  ["Azores", -60, "Azores", "Atlantic/Azores"],
  ["Cape Verde", -60, "Cape Verde Is.", "Atlantic/Cape_Verde"],
  ["Greenwich", 0, "Casablanca, Monrovia", "Africa/Casablanca Africa/Monrovia"],
  [
    "GMT",
    0,
    "Greenwich Mean Time : Dublin, Edinburgh, Lisbon, London",
    "Europe/London Europe/Dublin Europe/Lisbon UTC Etc/UTC",
  ],
  [
    "W. Europe",
    60,
    "Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna",
    "Europe/Amsterdam Europe/Berlin Europe/Zurich Europe/Rome Europe/Stockholm Europe/Vienna",
  ],
  [
    "Central Europe",
    60,
    "Belgrade, Bratislava, Budapest, Ljubljana, Prague",
    "Europe/Belgrade Europe/Bratislava Europe/Budapest Europe/Ljubljana Europe/Prague",
  ],
  [
    "Romance",
    60,
    "Brussels, Copenhagen, Madrid, Paris",
    "Europe/Brussels Europe/Copenhagen Europe/Madrid Europe/Paris",
  ],
  [
    "Central European",
    60,
    "Sarajevo, Skopje, Warsaw, Zagreb",
    "Europe/Sarajevo Europe/Skopje Europe/Warsaw Europe/Zagreb",
  ],
  ["W. Central Africa", 60, "West Central Africa", "Africa/Lagos"],
  [
    "GTB",
    120,
    "Athens, Istanbul, Minsk",
    "Europe/Athens Europe/Istanbul Europe/Minsk",
  ],
  ["E. Europe", 120, "Bucharest", "Europe/Bucharest"],
  ["Egypt", 120, "Cairo", "Africa/Cairo"],
  [
    "South Africa",
    120,
    "Harare, Pretoria",
    "Africa/Harare Africa/Johannesburg",
  ],
  [
    "FLE",
    120,
    "Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius",
    "Europe/Helsinki Europe/Kiev Europe/Kyiv Europe/Riga Europe/Sofia Europe/Tallinn Europe/Vilnius",
  ],
  ["Israel", 120, "Jerusalem", "Asia/Jerusalem"],
  ["Arabic", 180, "Baghdad", "Asia/Baghdad"],
  ["Arab", 180, "Kuwait, Riyadh", "Asia/Kuwait Asia/Riyadh"],
  [
    "Russian",
    180,
    "Moscow, St. Petersburg, Volgograd",
    "Europe/Moscow Europe/Volgograd",
  ],
  ["E. Africa", 180, "Nairobi", "Africa/Nairobi"],
  ["Iran", 210, "Tehran", "Asia/Tehran"],
  ["Arabian", 240, "Abu Dhabi, Muscat", "Asia/Dubai Asia/Muscat"],
  [
    "Caucasus",
    240,
    "Baku, Tbilisi, Yerevan",
    "Asia/Baku Asia/Tbilisi Asia/Yerevan",
  ],
  ["Afghanistan", 270, "Kabul", "Asia/Kabul"],
  ["Ekaterinburg", 300, "Ekaterinburg", "Asia/Yekaterinburg"],
  [
    "West Asia",
    300,
    "Islamabad, Karachi, Tashkent",
    "Asia/Karachi Asia/Tashkent",
  ],
  [
    "India",
    330,
    "Chennai, Kolkata, Mumbai, New Delhi",
    "Asia/Kolkata Asia/Calcutta",
  ],
  ["Nepal", 345, "Kathmandu", "Asia/Kathmandu Asia/Katmandu"],
  [
    "N. Central Asia",
    360,
    "Almaty, Novosibirsk",
    "Asia/Almaty Asia/Novosibirsk",
  ],
  ["Central Asia", 360, "Astana, Dhaka", "Asia/Dhaka"],
  ["Sri Lanka", 360, "Sri Jayawardenepura", "Asia/Colombo"],
  ["Myanmar", 390, "Rangoon", "Asia/Rangoon Asia/Yangon"],
  [
    "SE Asia",
    420,
    "Bangkok, Hanoi, Jakarta",
    "Asia/Bangkok Asia/Ho_Chi_Minh Asia/Saigon Asia/Jakarta",
  ],
  ["North Asia", 420, "Krasnoyarsk", "Asia/Krasnoyarsk"],
  [
    "China",
    480,
    "Beijing, Chongqing, Hong Kong, Urumqi",
    "Asia/Shanghai Asia/Hong_Kong Asia/Urumqi",
  ],
  [
    "North Asia East",
    480,
    "Irkutsk, Ulaan Bataar",
    "Asia/Irkutsk Asia/Ulaanbaatar",
  ],
  [
    "Singapore",
    480,
    "Kuala Lumpur, Singapore",
    "Asia/Kuala_Lumpur Asia/Singapore",
  ],
  ["W. Australia", 480, "Perth", "Australia/Perth"],
  ["Taipei", 480, "Taipei", "Asia/Taipei"],
  ["Tokyo", 540, "Osaka, Sapporo, Tokyo", "Asia/Tokyo"],
  ["Korea", 540, "Seoul", "Asia/Seoul"],
  ["Yakutsk", 540, "Yakutsk", "Asia/Yakutsk"],
  ["Cen. Australia", 570, "Adelaide", "Australia/Adelaide"],
  ["AUS Central", 570, "Darwin", "Australia/Darwin"],
  ["E. Australia", 600, "Brisbane", "Australia/Brisbane"],
  [
    "AUS Eastern",
    600,
    "Canberra, Melbourne, Sydney",
    "Australia/Sydney Australia/Melbourne Australia/Canberra",
  ],
  [
    "West Pacific",
    600,
    "Guam, Port Moresby",
    "Pacific/Guam Pacific/Port_Moresby",
  ],
  ["Tasmania", 600, "Hobart", "Australia/Hobart"],
  ["Vladivostok", 600, "Vladivostok", "Asia/Vladivostok"],
  [
    "Central Pacific",
    660,
    "Magadan, Solomon Is., New Caledonia",
    "Asia/Magadan Pacific/Guadalcanal Pacific/Noumea",
  ],
  ["New Zealand", 720, "Auckland, Wellington", "Pacific/Auckland"],
  [
    "Fiji",
    720,
    "Fiji, Kamchatka, Marshall Is.",
    "Pacific/Fiji Asia/Kamchatka Pacific/Majuro",
  ],
  ["Tonga", 780, "Nuku'alofa", "Pacific/Tongatapu"],
].map(([id, offset, cities, zones = ""]) => {
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return {
    id,
    offset,
    label: offset
      ? `(GMT${offset < 0 ? "-" : "+"}${hours}:${minutes}) ${cities}`
      : `(GMT) ${cities}`,
    standardName: id.endsWith(" 2") ? id : `${id} Standard Time`,
    zones: zones.split(" "),
  };
});

const TIME_ZONE_KEY = "timeZone";
const TIME_SYNC_KEY = "timeSync";

// The host's zone, matched by name and then by its current UTC offset.
const getHostTimeZone = () => {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -new Date().getTimezoneOffset();
  return (
    XP_TIME_ZONES.find((zone) => zone.zones.includes(name)) ||
    XP_TIME_ZONES.find((zone) => zone.offset === offset) ||
    XP_TIME_ZONES.find((zone) => zone.id === "GMT")
  );
};

const getShellTimeZone = () =>
  XP_TIME_ZONES.find(
    (zone) => zone.id === localStorage.getItem(TIME_ZONE_KEY),
  ) || getHostTimeZone();

const readTimeSync = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(TIME_SYNC_KEY));
    return {
      enabled: stored?.enabled !== false,
      server:
        stored?.server === "time.nist.gov" ? stored.server : "time.windows.com",
      last: Number.isFinite(stored?.last) ? stored.last : null,
    };
  } catch {
    return { enabled: true, server: "time.windows.com", last: null };
  }
};

// The clock face from timedate.cpl, drawn pixel for pixel: twelve 2px hour
// marks, hour and minute hands as filled quadrilaterals with a white
// highlight and a shadow offset by 2px, and a second hand that inverts what
// lies under it. Positions come from a sine table scaled by 8000, rounded
// the way GDI's MulDiv rounds.
const CLOCK_SIZE = 148;
const CLOCK_SHADOWS = {
  blue: [172, 168, 153],
  silver: [157, 157, 161],
  classic: [128, 128, 128],
};
const CLOCK_CENTER = { x: 74, y: 73 };

const clockPoint = (position, length) => {
  const angle = (position * Math.PI) / 30;
  const sin = Math.round(Math.sin(angle) * 8000);
  const cos = Math.round(Math.cos(angle) * 8000);
  return [
    Math.round((sin * length) / 8000),
    Math.round((-cos * length) / 8000),
  ];
};

const clockHand = (position, tip, halfWidth, tail) => {
  const { x, y } = CLOCK_CENTER;
  const [tipX, tipY] = clockPoint(position, tip);
  const [sideX, sideY] = clockPoint((position + 15) % 60, halfWidth);
  const [tailX, tailY] = clockPoint(position, tail);
  return [
    [x + tipX, y + tipY],
    [x + sideX, y + sideY],
    [x - tailX, y - tailY],
    [x - sideX, y - sideY],
  ];
};

const insidePolygon = (points, px, py) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const drawXpClockFace = (canvas, date) => {
  const context = canvas.getContext("2d");
  const image = context.getImageData(0, 0, CLOCK_SIZE, CLOCK_SIZE);
  image.data.fill(0);
  const plot = (x, y, color) => {
    image.data.set([...color, 255], (y * CLOCK_SIZE + x) * 4);
  };
  // The shadow is the scheme's 3D shadow color.
  const shadow =
    CLOCK_SHADOWS[document.documentElement.dataset.xpAppearance] ||
    CLOCK_SHADOWS.blue;
  const { x: centerX, y: centerY } = CLOCK_CENTER;
  for (let hour = 0; hour < 12; hour += 1) {
    const [dx, dy] = clockPoint(hour * 5, 62);
    for (const row of [-1, 0]) {
      plot(centerX + dx - 1, centerY + dy + row, [0, 255, 255]);
      plot(centerX + dx, centerY + dy + row, [0, 0, 0]);
    }
  }
  const minutes = date.getMinutes();
  const hands = [
    clockHand(
      ((date.getHours() % 12) * 5 + Math.floor(minutes / 12)) % 60,
      40,
      4,
      9,
    ),
    clockHand(minutes, 50, 3, 12),
  ];
  for (const hand of hands) {
    for (const [color, shift] of [
      [[255, 255, 255], -2],
      [shadow, 2],
      [[0, 128, 128], 0],
    ]) {
      const points = hand.map(([x, y]) => [x + shift, y + shift]);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) {
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) {
          if (insidePolygon(points, x, y)) plot(x, y, color);
        }
      }
    }
  }
  context.putImageData(image, 0, 0);
};

// The second hand is a GDI line without its last pixel, drawn white on a
// layer that inverts the face and background under it.
const drawXpClockSecondHand = (canvas, date) => {
  const context = canvas.getContext("2d");
  const image = context.getImageData(0, 0, CLOCK_SIZE, CLOCK_SIZE);
  image.data.fill(0);
  let { x, y } = CLOCK_CENTER;
  const [dx, dy] = clockPoint(date.getSeconds(), 50);
  const endX = x + dx;
  const endY = y + dy;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let error = Math.abs(dx) - Math.abs(dy);
  while (x !== endX || y !== endY) {
    image.data.set([255, 255, 255, 255], (y * CLOCK_SIZE + x) * 4);
    const doubled = 2 * error;
    if (doubled >= -Math.abs(dy)) {
      error -= Math.abs(dy);
      x += stepX;
    }
    if (doubled <= Math.abs(dx)) {
      error += Math.abs(dx);
      y += stepY;
    }
  }
  context.putImageData(image, 0, 0);
};

const DATETIME_HELP = {
  date: "Displays the date currently set on your computer. To change it, click a month and year, and then click a day on the calendar.",
  time: "Displays the time currently set on your computer. To change it, click the hour, minutes, seconds, or AM/PM, and then type a new value or click the arrows.",
  zone: "Displays the time zone your computer uses. To change it, click a time zone in the list.",
  sync: "Specifies whether your computer clock is synchronized with an Internet time server once a week.",
  server: "Specifies the Internet time server your computer synchronizes with.",
  update: "Synchronizes your computer clock with the Internet time server now.",
};

const openDateTimeProperties = () => {
  const dialog = XPDialogs.createDialog({
    title: "Date and Time Properties",
    help: true,
  });
  dialog.el.classList.add("datetime-dialog");

  const shellNow = getShellTime();
  const state = {
    year: shellNow.getFullYear(),
    month: shellNow.getMonth(),
    day: shellNow.getDate(),
    // The clock keeps running until the time is edited.
    time: shellNow,
    timeEdited: false,
    zone: getShellTimeZone(),
    sync: readTimeSync(),
  };
  const dateFormat = new Intl.DateTimeFormat("en-US");
  const shortTimeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  dialog.body.innerHTML = `
    <div class="datetime-tabs" role="tablist" aria-label="Date and Time Properties"></div>
    <section class="datetime-panel datetime-date-panel" role="tabpanel">
      <fieldset class="dlg-group datetime-date-group"><legend>Date</legend></fieldset>
      <select class="xp-select dlg-month-select" aria-label="Month" data-help="${DATETIME_HELP.date}"></select>
      <input type="text" class="xp-input dlg-year-input" aria-label="Year" inputmode="numeric" maxlength="4" data-help="${DATETIME_HELP.date}">
      <span class="xp-updown datetime-year-spin" data-help="${DATETIME_HELP.date}"><button type="button" tabindex="-1" aria-label="Next year">▲</button><button type="button" tabindex="-1" aria-label="Previous year">▼</button></span>
      <div class="dlg-calendar" data-help="${DATETIME_HELP.date}"></div>
      <fieldset class="dlg-group datetime-time-group"><legend>Time</legend></fieldset>
      <canvas class="datetime-clock" width="${CLOCK_SIZE}" height="${CLOCK_SIZE}" aria-hidden="true" data-help="${DATETIME_HELP.time}"></canvas>
      <canvas class="datetime-clock-second" width="${CLOCK_SIZE}" height="${CLOCK_SIZE}" aria-hidden="true"></canvas>
      <input type="text" class="xp-input datetime-time-input" aria-label="Time" data-help="${DATETIME_HELP.time}">
      <span class="xp-updown datetime-time-spin" data-help="${DATETIME_HELP.time}"><button type="button" tabindex="-1" aria-label="Increase time">▲</button><button type="button" tabindex="-1" aria-label="Decrease time">▼</button></span>
      <p class="datetime-current-zone" data-help="${DATETIME_HELP.zone}"></p>
    </section>
    <section class="datetime-panel datetime-time-zone-panel" role="tabpanel" hidden>
      <select class="xp-select datetime-zone-select" aria-label="Time zone" data-help="${DATETIME_HELP.zone}"></select>
      <img class="datetime-zone-map" src="assets/xp/TimeZoneMap.png" alt="World time zone map" draggable="false">
    </section>
    <section class="datetime-panel datetime-internet-panel" role="tabpanel" hidden>
      <label class="datetime-sync-label" data-help="${DATETIME_HELP.sync}"><input type="checkbox">Automatically synchronize with an Internet time server</label>
      <label class="datetime-server-label" for="datetime-server">Server:</label>
      <select class="xp-select datetime-server-select" id="datetime-server" data-help="${DATETIME_HELP.server}"><option>time.windows.com</option><option>time.nist.gov</option></select>
      <button type="button" class="xp-btn datetime-update-now" data-help="${DATETIME_HELP.update}">Update Now</button>
      <p class="datetime-sync-status"></p>
      <p class="datetime-next-sync"></p>
      <p class="datetime-sync-note">Synchronization can occur only when your computer is connected to the Internet.  Learn more about <u>time synchronization</u> in Help and Support Center.</p>
    </section>`;
  const $ = (selector) => dialog.body.querySelector(selector);
  const tabs = $(".datetime-tabs");
  const monthSelect = $(".dlg-month-select");
  const yearInput = $(".dlg-year-input");
  const calendar = $(".dlg-calendar");
  const clockFace = $(".datetime-clock");
  const clockSecond = $(".datetime-clock-second");
  const timeInput = $(".datetime-time-input");
  const zoneText = $(".datetime-current-zone");
  const zoneSelect = $(".datetime-zone-select");
  const syncCheckbox = $(".datetime-sync-label input");
  const serverSelect = $(".datetime-server-select");
  const updateNow = $(".datetime-update-now");
  const syncStatus = $(".datetime-sync-status");
  const nextSync = $(".datetime-next-sync");

  MONTH_NAMES.forEach((monthName, index) => {
    monthSelect.add(new Option(monthName, String(index)));
  });
  monthSelect.value = String(state.month);
  yearInput.value = String(state.year);
  XP_TIME_ZONES.forEach((zone) => {
    zoneSelect.add(new Option(zone.label, zone.id));
  });
  zoneSelect.value = state.zone.id;
  zoneText.textContent = `Current time zone:  ${state.zone.standardName}`;

  const panels = [...dialog.body.querySelectorAll(".datetime-panel")];
  ["Date & Time", "Time Zone", "Internet Time"].forEach((label, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(index === 0));
    tab.classList.toggle("active", index === 0);
    tab.textContent = label;
    tab.addEventListener("click", () => {
      panels.forEach((panel, panelIndex) => {
        panel.hidden = panelIndex !== index;
      });
      // Like a property sheet, the page's first control takes the focus.
      panels[index].querySelector("select, input").focus();
      [...tabs.children].forEach((candidate) => {
        const selected = candidate === tab;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-selected", String(selected));
      });
    });
    tabs.appendChild(tab);
  });

  const renderCalendar = () => {
    calendar.replaceChildren(
      ...DAY_LETTERS.map((letter) => {
        const head = document.createElement("span");
        head.className = "dlg-calendar-head";
        head.textContent = letter;
        return head;
      }),
    );
    const firstWeekday = new Date(state.year, state.month, 1).getDay();
    for (let i = 0; i < firstWeekday; i += 1) {
      calendar.appendChild(document.createElement("span"));
    }
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayButton = document.createElement("button");
      dayButton.type = "button";
      dayButton.tabIndex = -1;
      dayButton.className = "dlg-calendar-day";
      dayButton.classList.toggle("selected", day === state.day);
      dayButton.textContent = String(day);
      dayButton.addEventListener("click", () => {
        state.day = day;
        renderCalendar();
      });
      calendar.appendChild(dayButton);
    }
  };

  const formatTime = (date) =>
    date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  const parseTime = (value) => {
    const match = /^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
    const time = new Date(2000, 0, 1);
    if (match) {
      let hours = Math.min(Math.max(parseInt(match[1], 10), 1), 12) % 12;
      if (match[4].toUpperCase() === "PM") hours += 12;
      time.setHours(
        hours,
        Math.min(parseInt(match[2], 10), 59),
        Math.min(parseInt(match[3], 10), 59),
      );
    }
    return time;
  };
  const showTime = (date) => {
    state.time = date;
    timeInput.value = formatTime(date);
    drawXpClockFace(clockFace, date);
    drawXpClockSecondHand(clockSecond, date);
  };
  showTime(shellNow);
  const tick = setInterval(() => {
    if (!dialog.el.isConnected) {
      clearInterval(tick);
      return;
    }
    if (!state.timeEdited) showTime(getShellTime());
  }, 1000);

  const setYear = (year) => {
    state.year = Number.isFinite(year)
      ? Math.min(Math.max(year, 1901), 2099)
      : state.year;
    yearInput.value = String(state.year);
    state.day = Math.min(
      state.day,
      new Date(state.year, state.month + 1, 0).getDate(),
    );
    renderCalendar();
  };
  monthSelect.addEventListener("change", () => {
    state.month = parseInt(monthSelect.value, 10);
    setYear(state.year);
  });
  yearInput.addEventListener("change", () => {
    setYear(parseInt(yearInput.value, 10));
  });
  $(".datetime-year-spin").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setYear(
      state.year + (button.getAttribute("aria-label") === "Next year" ? 1 : -1),
    );
    markDirty();
  });

  // The up-down changes the part of the time the caret is in, like the
  // time picker: hours, minutes, seconds, or AM/PM.
  let timeField = 0;
  const rememberTimeField = () => {
    const caret = timeInput.selectionStart;
    const separators = [...timeInput.value.matchAll(/[: ]/g)].map(
      (match) => match.index,
    );
    timeField = separators.filter((index) => index < caret).length;
  };
  timeInput.addEventListener("click", rememberTimeField);
  timeInput.addEventListener("keyup", rememberTimeField);
  timeInput.addEventListener("input", () => {
    state.timeEdited = true;
  });
  timeInput.addEventListener("change", () => {
    state.timeEdited = true;
    showTime(parseTime(timeInput.value));
  });
  $(".datetime-time-spin").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const step = button.getAttribute("aria-label") === "Increase time" ? 1 : -1;
    const time = parseTime(timeInput.value);
    if (timeField === 0) time.setHours(time.getHours() + step);
    else if (timeField === 1) time.setMinutes(time.getMinutes() + step);
    else if (timeField === 2) time.setSeconds(time.getSeconds() + step);
    else time.setHours(time.getHours() + 12);
    state.timeEdited = true;
    showTime(time);
    markDirty();
  });

  const renderSync = () => {
    const { enabled, server, last } = state.sync;
    syncCheckbox.checked = enabled;
    serverSelect.value = server;
    serverSelect.disabled = !enabled;
    updateNow.disabled = !enabled;
    syncStatus.textContent = last
      ? `The time has been successfully synchronized with ${server} on ${dateFormat.format(last)} at ${shortTimeFormat.format(last)}.`
      : "Windows has never attempted to synchronize with an internet time server.";
    const next = last ? new Date(last + 7 * 86400000) : getShellTime();
    nextSync.hidden = !enabled;
    nextSync.textContent = `Next synchronization: ${dateFormat.format(next)} at ${shortTimeFormat.format(next)}`;
  };
  const saveSync = () => {
    localStorage.setItem(TIME_SYNC_KEY, JSON.stringify(state.sync));
  };
  renderSync();
  syncCheckbox.addEventListener("change", () => {
    state.sync.enabled = syncCheckbox.checked;
    saveSync();
    renderSync();
  });
  serverSelect.addEventListener("change", () => {
    state.sync.server = serverSelect.value;
    saveSync();
    renderSync();
  });
  // The host clock stands in for the time server: synchronizing drops any
  // manual change and keeps only the chosen time zone's difference.
  updateNow.addEventListener("click", () => {
    const hostOffset = -new Date().getTimezoneOffset();
    localStorage.setItem(
      CLOCK_OFFSET_KEY,
      String((state.zone.offset - hostOffset) * 60000),
    );
    updateClockDisplay();
    state.sync.last = getShellTime().getTime();
    saveSync();
    renderSync();
    state.timeEdited = false;
    showTime(getShellTime());
  });

  const applyDateTime = () => {
    // An untouched clock keeps running, so it applies the current time.
    const time = state.timeEdited ? parseTime(timeInput.value) : getShellTime();
    const chosen = new Date(
      state.year,
      state.month,
      state.day,
      time.getHours(),
      time.getMinutes(),
      time.getSeconds(),
    );
    // A new zone moves the clock by the difference between the zones.
    const zone = XP_TIME_ZONES.find((item) => item.id === zoneSelect.value);
    const zoneShift = (zone.offset - state.zone.offset) * 60000;
    localStorage.setItem(
      CLOCK_OFFSET_KEY,
      String(chosen.getTime() - Date.now() + zoneShift),
    );
    localStorage.setItem(TIME_ZONE_KEY, zone.id);
    state.zone = zone;
    zoneText.textContent = `Current time zone:  ${zone.standardName}`;
    updateClockDisplay();
    state.timeEdited = false;
    showTime(getShellTime());
    const now = getShellTime();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.day = now.getDate();
    monthSelect.value = String(state.month);
    yearInput.value = String(state.year);
    renderCalendar();
  };

  const row = document.createElement("div");
  row.className = "dlg-buttons";
  const okButton = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      applyDateTime();
      dialog.close("ok");
    },
  );
  const cancelButton = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel" },
    () => dialog.close(null),
  );
  const applyButton = XPDialogs.createDialogButton(
    { id: "apply", label: "Apply" },
    () => {
      applyDateTime();
      applyButton.disabled = true;
    },
  );
  applyButton.disabled = true;
  row.append(okButton, cancelButton, applyButton);
  dialog.body.appendChild(row);
  dialog.defaultButton = okButton;

  function markDirty() {
    applyButton.disabled = false;
  }
  [monthSelect, yearInput, timeInput, zoneSelect].forEach((control) =>
    control.addEventListener("change", markDirty),
  );
  calendar.addEventListener("click", markDirty);

  renderCalendar();
  // XP opens with the month list focused.
  monthSelect.focus();
};

const setupSystemTray = () => {
  const volumeMenu = document.getElementById("tray-volume-menu");
  wireTaskbarMenuKeyboard(volumeMenu);
  document
    .getElementById("tray-volume-button")
    .addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeTaskbarMenus();
      closeTrayVolumePopup();
      positionTaskbarMenu(volumeMenu, event.clientX, event.clientY);
    });
  volumeMenu.querySelector("button").addEventListener("click", () => {
    closeTaskbarMenus();
    openXPProgram("__volume-control");
  });
  document
    .getElementById("tray-volume-button")
    .addEventListener("click", toggleTrayVolumePopup);

  document
    .getElementById("taskbar-clock")
    .addEventListener("dblclick", openDateTimeProperties);
  document
    .getElementById("taskbar-clock")
    .addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDateTimeProperties();
      }
    });
  document
    .getElementById("tray-volume-button")
    .addEventListener("dblclick", () => {
      closeTrayVolumePopup();
      openXPProgram("__volume-control");
    });

  document
    .getElementById("tray-volume-slider")
    .addEventListener("input", (event) => {
      // Range inputs sanitize their value to a number.
      setSystemVolume(
        parseInt(event.target.value, 10),
        getSystemVolume().isMuted,
      );
    });
  document
    .getElementById("tray-mute-checkbox")
    .addEventListener("change", (event) => {
      setSystemVolume(getSystemVolume().volume, event.target.checked);
    });

  syncTrayVolumeUI();
};
