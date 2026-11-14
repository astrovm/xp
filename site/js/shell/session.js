"use strict";

// ============================================
// Screen Flow (boot -> welcome -> desktop)
// ============================================

// Original Windows XP system sounds (playback is skipped if the
// browser still blocks audio before the user's first interaction)
const xpSoundPaths = {
  error: "assets/xp/sounds/error.wav",
  logoff: "assets/xp/sounds/logoff.wav",
  logon: "assets/xp/sounds/logon.wav",
  shutdown: "assets/xp/sounds/shutdown.wav",
  startup: "assets/xp/sounds/startup.wav",
};

// Shell sounds follow Master and Wave. A balance away from center routes
// them through Web Audio to pan them.
let shellAudioContext = null;
const createXPSound = (name) => {
  const audio = new Audio(xpSoundPaths[name]);
  audio.volume = getAudioLevel();
  const pan = getAudioBalance();
  if (pan) {
    shellAudioContext ||= new AudioContext();
    shellAudioContext
      .createMediaElementSource(audio)
      .connect(new StereoPannerNode(shellAudioContext, { pan }))
      .connect(shellAudioContext.destination);
  }
  return audio;
};

const playXPSound = (name) =>
  createXPSound(name)
    .play()
    .then(
      () => true,
      () => false,
    );

// One startup playback per boot/logon. Welcome plays it once, and a later
// gesture retries only after the browser blocked that attempt, so calls never
// overlap or follow a successful playback.
let startupAudio = null;
const stopStartupSound = () => startupAudio?.pause();
const resetStartupSound = () => {
  stopStartupSound();
  startupAudio = null;
};
// Retry the same media element after an autoplay rejection. Retaining its
// ownership also lets a later session stop audio that has not finished yet.
const playStartupSound = () => {
  const { enabled, volume } = getStartupSound();
  // Muted counts as played, so no later gesture retries it.
  if (!enabled || volume === 0) return Promise.resolve(true);
  if (!startupAudio) {
    startupAudio = createXPSound("startup");
    startupAudio.volume *= volume / 100;
  }
  return startupAudio.play().then(
    () => true,
    () => false,
  );
};

let startupSoundPending = true;
let startupSoundBlocked = false;
let bootGeneration = 0;

const setScreen = (...visibleIds) => {
  [
    "boot-screen",
    "welcome-screen",
    "desktop",
    "taskbar",
    "shutdown-screen",
    "turn-off-screen",
  ].forEach((id) => {
    document.getElementById(id).hidden = !visibleIds.includes(id);
  });
};

const setSuspended = (value) => {
  suspended = value;
  const standbyScreen = document.getElementById("standby-screen");
  standbyScreen.hidden = !value;

  if (value) {
    closeStartMenu();
    closeDesktopContextMenu();
    closeWindowSystemMenu();
    closeTaskbarMenus();
    closeTrayVolumePopup();
    muteAllWindows();
    document.getElementById("standby-resume").focus();
  } else if (loggedIn) {
    applyFocusVolumes();
  }
};

// The control that had the keys before a system dialog opened.
let systemDialogReturnFocus = null;

// A closed system dialog gives the keys back, like XP.
const hideSystemDialogs = () => {
  const dialogs = ["logoff-dialog", "shutdown-dialog"].map((id) =>
    document.getElementById(id),
  );
  const hadKeys = dialogs.some((dialog) =>
    dialog.contains(document.activeElement),
  );
  dialogs.forEach((dialog) => (dialog.hidden = true));
  const target = systemDialogReturnFocus;
  systemDialogReturnFocus = null;
  if (hadKeys && !keysTaken(target)) giveKeysToActiveWindow();
};

// A system dialog takes the keys on its default button, like XP. A rename
// in progress loses them and so ends with its new name.
const showSystemDialog = (id) => {
  closeStartMenu();
  const dialog = document.getElementById(id);
  systemDialogReturnFocus = document.activeElement;
  dialog.hidden = false;
  dialog.querySelector("[data-default-focus]").focus();
};

const showLogoffDialog = () => showSystemDialog("logoff-dialog");

const showShutdownDialog = () => showSystemDialog("shutdown-dialog");

const muteAllWindows = () => {
  openWindows.forEach((win) => setPlayerVolume(win.player, win.type, 0));
};

const finishBootSequence = () => {
  if (document.getElementById("boot-screen").hidden) return;
  bootGeneration++;
  clearTimeout(bootTimeout);
  showWelcomeScreen(true);
};

const showBootScreen = () => {
  const generation = ++bootGeneration;
  setSuspended(false);
  hideSystemDialogs();
  clearTimeout(shutdownTimeout);
  muteAllWindows();
  setScreen("boot-screen");
  const bootScreen = document.getElementById("boot-screen");
  bootScreen.classList.remove("boot-running", "boot-handoff");
  bootScreen.focus({ preventScroll: true });
  resetStartupSound();
  startupSoundPending = true;
  startupSoundBlocked = false;
  clearTimeout(bootTimeout);
  const isCurrentBoot = () =>
    generation === bootGeneration && !bootScreen.hidden;
  // Start the palette only once its original bitmaps are decoded. Slow asset
  // loading must not consume the animation while the screen is still blank.
  const imagesReady = Promise.allSettled(
    [...bootScreen.querySelectorAll("img")].map((image) => image.decode()),
  );
  const minimumDisplayComplete = imagesReady.then(() => {
    if (!isCurrentBoot()) return;
    bootScreen.classList.add("boot-running");
    return new Promise((resolve) => {
      bootTimeout = setTimeout(
        resolve,
        useQuickStartup()
          ? QUICK_BOOT_MINIMUM_DURATION_MS
          : BOOT_MINIMUM_DURATION_MS,
      );
    });
  });
  // XP advances when startup finishes; a browser's storage/runtime startup
  // takes a different amount of time from an emulated machine's disk I/O.
  void Promise.allSettled([
    minimumDisplayComplete,
    fs.ready,
    gameLibraryInitialization,
  ]).then(() => {
    if (!isCurrentBoot()) return;
    // Present the final palette even when storage was ready before the fade.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!isCurrentBoot()) return;
        bootScreen.classList.add("boot-handoff");
        // Paint the cleared framebuffer before entering the desktop mode.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (isCurrentBoot()) finishBootSequence();
          }),
        );
      }),
    );
  });
};

const showWelcomeScreen = (autoLogin) => {
  setSuspended(false);
  hideSystemDialogs();
  clearTimeout(bootTimeout);
  muteAllWindows();
  const welcomeScreen = document.getElementById("welcome-screen");
  const loginUser = document.getElementById("login-user");
  welcomeScreen.classList.toggle("auto-login", autoLogin);
  welcomeScreen.querySelector(".welcome-username").textContent = fs.USER_NAME;
  const status = document.getElementById("welcome-user-status");
  status.hidden = !loggedIn;
  const programCount = loggedIn ? openWindows.size : 0;
  status.classList.toggle("has-programs", programCount > 0);
  status.textContent = programCount
    ? `${programCount} program${programCount === 1 ? "" : "s"} running.`
    : "Logged on";
  if (autoLogin) {
    welcomeScreen.setAttribute("role", "button");
    welcomeScreen.setAttribute("tabindex", "0");
    welcomeScreen.setAttribute("aria-label", "Continue to the desktop");
  } else {
    welcomeScreen.removeAttribute("role");
    welcomeScreen.setAttribute("tabindex", "-1");
    welcomeScreen.removeAttribute("aria-label");
  }
  setScreen("welcome-screen");
  const focusTarget = autoLogin || !loggedIn ? welcomeScreen : loginUser;
  focusTarget.focus({ preventScroll: true });
  // Keyboard activation can finish after this handler moves focus.
  requestAnimationFrame(() => {
    if (!welcomeScreen.hidden) focusTarget.focus({ preventScroll: true });
  });
  if (startupSoundPending) {
    startupSoundPending = false;
    const generation = bootGeneration;
    void playStartupSound().then((played) => {
      if (generation === bootGeneration)
        startupSoundBlocked = !played && !welcomeScreen.hidden && autoLogin;
    });
  }
  if (autoLogin) {
    bootTimeout = setTimeout(
      () => login(),
      useQuickStartup() ? QUICK_WELCOME_DURATION_MS : WELCOME_DURATION_MS,
    );
  }
};

const showDesktop = () => {
  setScreen("desktop", "taskbar");
  closeStartMenu();
};

const showTurnOffScreen = () => {
  muteAllWindows();
  setScreen("turn-off-screen");
};

const startShutdown = (restart) => {
  setSuspended(false);
  hideSystemDialogs();
  muteAllWindows();
  stopStartupSound();
  playXPSound("shutdown");
  setScreen("shutdown-screen");
  clearTimeout(shutdownTimeout);
  shutdownTimeout = setTimeout(
    restart ? showBootScreen : showTurnOffScreen,
    1800,
  );
};

let sessionClosePromise = null;
const closeCurrentSession = () => {
  if (sessionClosePromise) return sessionClosePromise;
  sessionClosePromise = (async () => {
    sessionGeneration++;
    const windows = [...openWindows.values()];
    for (const win of windows) {
      if (win.closePromise) {
        if ((await win.closePromise) === false) return false;
      } else if (win.beforeClose && (await win.beforeClose()) === false) {
        return false;
      }
    }
    // Skipping beforeClose, closing a window always succeeds.
    for (const win of windows)
      await closeGameWindow(win.gameId, { skipBeforeClose: true });
    clearTimeout(screenSaverTimeout);
    // The screen saver overlay is created at the first logon, so a restart
    // from the Welcome screen before then has none to hide.
    const screenSaver = document.getElementById("screen-saver-overlay");
    if (screenSaver) hideScreenSaver(screenSaver);
    showDesktopSnapshot = null;
    closeStartMenu();
    closeDesktopContextMenu();
    closeWindowSystemMenu();
    closeTaskbarMenus();
    closeTrayVolumePopup();
    focusedGameId = null;
    zIndexCounter = 100;
    cascadeCount = 0;
    loggedIn = false;
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return true;
  })()
    .catch((error) => {
      void XPDialogs.alert(
        error.message || "The session could not be closed.",
        "Astro XP",
        "error",
      );
      return false;
    })
    .finally(() => {
      sessionClosePromise = null;
    });
  return sessionClosePromise;
};

const logOff = async () => {
  hideSystemDialogs();
  if (!(await closeCurrentSession())) return;
  stopStartupSound();
  playXPSound("shutdown");
  resetStartupSound();
  showWelcomeScreen(false);
};

const switchUser = () => {
  // Fast User Switching leaves this session intact. The desktop is simply
  // hidden behind the logon screen until this user signs in again.
  stopStartupSound();
  playXPSound("logoff");
  showWelcomeScreen(false);
};

const restart = async () => {
  hideSystemDialogs();
  if (!(await closeCurrentSession())) return;
  startShutdown(true);
};

const turnOff = async () => {
  hideSystemDialogs();
  if (!(await closeCurrentSession())) return;
  startShutdown(false);
};

let loginPromise = null;
const login = (playSound = true) => {
  // Every caller shows the Welcome screen first; the automatic logon timer can
  // still fire while a logon waits for document storage.
  if (loginPromise) return loginPromise;
  startupSoundBlocked = false;
  const welcomeScreen = document.getElementById("welcome-screen");
  const loginUser = document.getElementById("login-user");
  const manualLogon = !welcomeScreen.classList.contains("auto-login");
  const logonSound = loggedIn ? "logon" : "startup";
  if (
    !welcomeScreen.hidden &&
    !welcomeScreen.classList.contains("auto-login")
  ) {
    welcomeScreen.classList.add("logging-in");
    welcomeScreen.setAttribute("aria-busy", "true");
    loginUser.disabled = true;
    const status = document.getElementById("welcome-user-status");
    status.classList.remove("has-programs");
    status.textContent = "Loading your personal settings...";
    status.hidden = false;
  }
  loginPromise = (async () => {
    await fs.ready;
    if (!shellInitialized) await syncGameFiles();
    clearTimeout(bootTimeout);
    loggedIn = true;
    setStartupFlag(STARTUP_SEEN_KEY, true);
    showDesktop();
    applyDisplaySettings(getDisplaySettings());
    applyStartMenuStyle(getStartMenuStyle(), false);
    applyFocusVolumes();
    if (playSound && manualLogon) {
      if (logonSound === "startup") void playStartupSound();
      else void playXPSound(logonSound);
    }

    if (!shellInitialized) {
      shellInitialized = true;
      buildDesktopIcons();
      buildPlaces();
      setupSearch();
      setupScreenSaver();
      startClock();
      // System windows and XP programs load their modules on first use; warm
      // them once the desktop is idle so the first open does not wait.
      const warmApplications = () =>
        window.XPApplicationRegistry?.values().forEach((application) => {
          if (["system", "native-game"].includes(application.kind))
            application.load?.().catch(() => {});
        });
      if (typeof requestIdleCallback === "function")
        requestIdleCallback(warmApplications, { timeout: 5000 });
      else setTimeout(warmApplications, 2000);

      // Deep link: #game-id opens that game's window
      const gameId = getHashGameId();
      if (gameId) {
        openLinkedGame(gameId);
      }
    }
    scheduleScreenSaver();
  })().finally(() => {
    welcomeScreen.classList.remove("logging-in");
    welcomeScreen.removeAttribute("aria-busy");
    loginUser.disabled = false;
    loginPromise = null;
  });
  return loginPromise;
};

const continueWelcomeFromInput = () => {
  if (document.getElementById("welcome-screen").hidden || loginPromise) return;
  if (startupSoundBlocked) {
    startupSoundBlocked = false;
    void playStartupSound();
  }
  return login();
};

const setupScreenFlow = () => {
  const bootScreen = document.getElementById("boot-screen");
  bootScreen.addEventListener("click", finishBootSequence);
  bootScreen.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    finishBootSequence();
  });
  document
    .getElementById("welcome-screen")
    .addEventListener("click", (event) => {
      if (event.target.closest("#welcome-turn-off, #welcome-user-status"))
        return;
      if (
        event.currentTarget.classList.contains("auto-login") ||
        event.target.closest("#login-user")
      )
        continueWelcomeFromInput();
    });
  document
    .getElementById("welcome-screen")
    .addEventListener("keydown", (event) => {
      if (
        !event.currentTarget.classList.contains("auto-login") ||
        event.target !== event.currentTarget ||
        !["Enter", " "].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      continueWelcomeFromInput();
    });
  document.getElementById("turn-off-screen").addEventListener("click", () => {
    if (!document.getElementById("turn-off-screen").hidden) showBootScreen();
  });

  document.getElementById("welcome-turn-off").addEventListener("click", () => {
    showShutdownDialog();
  });

  document.getElementById("log-off-button").addEventListener("click", () => {
    showLogoffDialog();
  });

  document.getElementById("turn-off-button").addEventListener("click", () => {
    showShutdownDialog();
  });

  // Tab and Shift+Tab stay in a system dialog, and Esc cancels it, like XP.
  document.querySelectorAll(".system-dialog-overlay").forEach((overlay) => {
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideSystemDialogs();
        return;
      }
      if (event.key !== "Tab" || event.altKey) return;
      event.preventDefault();
      const buttons = [...overlay.querySelectorAll("button")];
      const step = event.shiftKey ? -1 : 1;
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + step + buttons.length) % buttons.length].focus();
    });
  });
  document
    .getElementById("logoff-cancel")
    .addEventListener("click", hideSystemDialogs);
  document
    .getElementById("shutdown-cancel")
    .addEventListener("click", hideSystemDialogs);
  document
    .getElementById("switch-user-confirm")
    .addEventListener("click", switchUser);
  document.getElementById("logoff-confirm").addEventListener("click", logOff);
  document
    .getElementById("shutdown-confirm")
    .addEventListener("click", turnOff);
  document.getElementById("restart-confirm").addEventListener("click", restart);
  document.getElementById("standby-confirm").addEventListener("click", () => {
    hideSystemDialogs();
    setSuspended(true);
  });
  document
    .getElementById("standby-resume")
    .addEventListener("click", () => setSuspended(false));
  document
    .getElementById("standby-screen")
    .addEventListener("pointerdown", () => setSuspended(false));

  if (getHashGameId()) {
    startupSoundPending = false;
    login(false);
  } else {
    showBootScreen();
  }
};
