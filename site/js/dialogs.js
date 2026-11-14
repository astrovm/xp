"use strict";

// ============================================
// Reusable Windows XP Dialogs
// ============================================
// Modal dialogs with authentic XP chrome, focus trapping, focus restore,
// and Enter/Escape/Tab/access-key navigation. A single primitive
// (createDialog) backs message boxes, progress, properties, and the
// filesystem-backed Open/Save As dialogs, so every shell feature shares
// the same appearance and keyboard behavior. Pure definitions (button
// sets, access keys, byte formatting) are exported for Node tests.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.XPDialogs = api;
})(globalThis, function () {
  // ---- Pure definitions (no DOM, unit tested) ----

  const ICONS = ["info", "warning", "error", "question", "recycle"];

  // Standard XP button sets. The first button is the default unless a
  // later one sets isDefault; isCancel marks the Escape/close result.
  const BUTTON_SETS = {
    ok: [{ id: "ok", label: "OK", isDefault: true, isCancel: true }],
    okCancel: [
      { id: "ok", label: "OK", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
    // XP's Yes/No message box has a gray close button: only Yes or No
    // closes it.
    yesNo: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "no", label: "&No" },
    ],
    // XP's own Yes/No dialogs, such as Confirm File Delete, close with No
    // on Esc or the close button.
    yesNoClosable: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "no", label: "&No", isCancel: true },
    ],
    yesNoCancel: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "no", label: "&No" },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
    // XP's Confirm File Replace and Confirm Folder Replace.
    yesAllNoCancel: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "all", label: "Yes to &All" },
      { id: "no", label: "&No" },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
    retryCancel: [
      { id: "retry", label: "&Retry", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
  };

  // "&Yes" -> { text: "Yes", key: "y" }. "&&" escapes a literal ampersand.
  const parseAccessKey = (label) => {
    const match = /&([^&])/.exec(label);
    return {
      text: label.replace(/&([^&])/g, "$1").replace(/&&/g, "&"),
      key: match ? match[1].toLowerCase() : null,
    };
  };

  // XP-style byte formatting: "5 bytes", "1.50 KB (1,536 bytes)".
  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
    if (bytes === 1) return "1 byte";
    if (bytes < 1024) return `${bytes} bytes`;
    const units = ["KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length) {
      value /= 1024;
      unit += 1;
    }
    const grouped = Math.round(bytes).toLocaleString("en-US");
    return `${value.toFixed(2)} ${units[unit - 1]} (${grouped} bytes)`;
  };

  // XP's Details view rounds every file up to whole KB: "0 KB", "1 KB",
  // "28 KB".
  const formatKilobytes = (bytes) =>
    `${Math.ceil(Math.max(0, bytes) / 1024).toLocaleString("en-US")} KB`;

  // XP's names for the file types the simulation stores. Other types show
  // their extension, like "ZIP File", and a file without one shows "File".
  const XP_FILE_TYPES = {
    ".bmp": "Bitmap Image",
    ".game": "Game",
    ".gif": "GIF Image",
    ".jpeg": "JPEG Image",
    ".jpg": "JPEG Image",
    ".png": "PNG Image",
    ".txt": "Text Document",
  };
  // The extensions that have a program in a new XP SP3, as the "assoc"
  // command lists them in an XP SP3 virtual machine. The simulation adds
  // its own ".game".
  const XP_REGISTERED_EXTENSIONS = new Set(
    `323 386 aca acf acs acw ai aif aifc aiff ani aps asa ascx asf asm asmx
    asp aspx asx au audiocd avi bat bfc bin bkf blg bmp bsc c cab cat cda
    cdf cdx cer cgm chk chm clp cmd cnf com cpl cpp crl crt css csv ctt
    cur cxx dat db dbg dct def der desklink dib dic diz dl_ dll doc dos
    dot drv dsn dun dvd dvr-ms emf eml eps ex_ exe exp eyb fif fnd fnt
    folder fon ghi gif grp gz h hhc hlp hpp hqx ht hta htc htm html htt
    htw htx hxx icc icm ico idb idl idq iii ilk imc in_ inc inf ini ins
    inv inx isp its ivf java jbf jfif job jod jpe jpeg jpg js jse latex
    lib lnk local log lwv m14 m1v m3u man manifest mapimail mdb mht mhtml
    mid midi mmf mmm mov movie mp2 mp2v mp3 mpa mpe mpeg mpg mpv2 msc msg
    msi msp msrcincident msstyles mswmm mv mydocs ncb nfo nls nmw nsc nvr
    nws obj oc_ ocx odc otf p10 p12 p7b p7c p7m p7r p7s pbk pch pdb pds
    pfm pfx php3 pic pif pko pl plg pma pmc pml pmr pmw pnf png pot pps
    ppt prf ps psd psw qds rat rc rdp reg res rle rmi rnk rpc rsp rtf sam
    sbr sc2 scf scp scr sct sdb sed shb shs shtml shw sit snd spc spl sql
    sr_ sst stl stm swf sy_ sym sys tar text tgz theme tif tiff tlb tsp
    tsv ttc ttf txt udl uls url vbe vbs vbx vcf vxd wab wav wax wb2 wdp
    webpnp wht wk4 wll wlt wm wma wmd wmdb wmf wmp wms wmv wmx wmz wpd wpg
    wpl wri wsc wsf wsh wsz wtx wvx x xbm xix xlb xlc xls xlt xml xsl z
    z96 zap zfsendtotarget zip game`
      .split(/\s+/)
      .map((extension) => `.${extension}`),
  );
  // A type that has a program, like ".txt" or ".mp3". XP asks before a
  // rename changes or removes the extension of a file of such a type.
  const isKnownFileType = (ext) =>
    XP_REGISTERED_EXTENSIONS.has(String(ext || "").toLowerCase());
  const describeFileType = (ext) => {
    const extension = String(ext || "").toLowerCase();
    if (!extension) return "File";
    return (
      XP_FILE_TYPES[extension] ||
      `${extension.replace(".", "").toUpperCase()} File`
    );
  };

  // XP's short date in Details: "4/14/2008 9:00 AM".
  const formatDetailsDate = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
  };

  // The input types that are not text boxes.
  const NOT_TEXT_INPUTS = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ]);
  // A control that takes typed text.
  const isEditable = (target) =>
    Boolean(target) &&
    (target.isContentEditable === true ||
      target.tagName === "TEXTAREA" ||
      (target.tagName === "INPUT" && !NOT_TEXT_INPUTS.has(target.type)));

  // True on a Mac, an iPhone or an iPad, where Option types characters.
  const isApplePlatform = () =>
    /^(?:mac|iphone|ipad|ipod)/i.test(
      navigator.userAgentData?.platform || navigator.platform,
    );

  // The letter of a Ctrl shortcut, such as S in Ctrl+S. Like Windows, a key
  // that types a Latin letter gives that letter, so AZERTY and Dvorak keep
  // their own letters. A key that types a letter of another script, such
  // as a Russian or Greek one, gives the letter of its place on the
  // keyboard, so Ctrl+S works with each layout. Other keys give their own
  // value.
  const shortcutKeyOf = (event) => {
    const key = event.key.toLowerCase();
    if (/^[a-z]$/.test(key)) return key;
    const place = /^Key([A-Z])$/.exec(event.code);
    return place && /^\p{L}$/u.test(key) ? place[1].toLowerCase() : key;
  };

  // The letter of an access key, such as F in Alt+F.
  // In a text box:
  // - A dead key (Option+E on a Mac starts an accent) is never an access
  //   key, because it types.
  // - On a Mac, the key gives only its own character, so Option types that
  //   character (Option+F types "ƒ").
  // - On Windows and Linux, the key gives the letter of a Ctrl shortcut: a
  //   key that types a letter that is not a Latin letter, such as a Greek
  //   or Russian one, gives the letter of its place on the keyboard, like
  //   Windows. A punctuation key, such as Dvorak's "." key, gives its own
  //   character.
  // Outside a text box nothing types. A key that is not a plain letter or
  // digit, a dead key too, gives the letter or digit of its place on the
  // keyboard. So Option works like Alt on a Mac.
  const accessKeyOf = (event) => {
    const key = event.key.toLowerCase();
    if (isEditable(event.target)) {
      if (event.key === "Dead") return "";
      return isApplePlatform() ? key : shortcutKeyOf(event);
    }
    if (/^[a-z0-9]$/.test(key)) return key;
    const place = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    return place ? (place[1] ?? place[2]).toLowerCase() : key;
  };

  // A key that an input method takes, such as the Enter that ends a
  // composition. A text box never acts on it.
  const isComposingKey = (event) =>
    event.isComposing === true || event.keyCode === 229;

  const hasDOM = typeof document !== "undefined";
  const getFS = () => globalThis.VirtualFS;

  if (!hasDOM) {
    // Node: expose only the pure definitions for tests.
    return {
      ICONS,
      BUTTON_SETS,
      parseAccessKey,
      accessKeyOf,
      shortcutKeyOf,
      isComposingKey,
      describeFileType,
      isKnownFileType,
      formatBytes,
      formatDetailsDate,
      formatKilobytes,
    };
  }

  // ---- Dialog stack and shared keyboard handling ----

  const BASE_Z_INDEX = 9000;
  const dialogStack = [];

  const FOCUSABLE = [
    "button",
    "input",
    "select",
    "textarea",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  const focusableItems = (el) =>
    Array.from(el.querySelectorAll(FOCUSABLE)).filter(
      (item) => !item.disabled && item.offsetParent !== null,
    );

  // An open modal dialog keeps the keys, like XP: they go to its control
  // that had them last, its default button or its first control, never to
  // a window behind it. It returns false when no modal dialog is open.
  const takeKeys = () => {
    const dialog = dialogStack.findLast((entry) => entry.modal);
    if (!dialog) return false;
    [
      dialog.lastFocused,
      dialog.defaultButton,
      ...focusableItems(dialog.el),
    ].some((target) => {
      if (!target?.isConnected || target.disabled) return false;
      target.focus();
      return document.activeElement === target;
    });
    return true;
  };

  // Registered only while a dialog is open, so the stack is never empty here.
  const handleGlobalKeydown = (e) => dialogStack.at(-1).onKeydown(e);

  // ---- Core primitive ----

  // XP's balloon tip under a text box. It closes on the box's next key,
  // when the box loses the keys, or after 10 seconds.
  const showBalloon = (anchor, lines) => {
    document.querySelector(".xp-balloon")?.close();
    const balloon = document.createElement("div");
    balloon.className = "xp-balloon";
    balloon.setAttribute("role", "tooltip");
    lines.forEach((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      balloon.append(row);
    });
    document.body.append(balloon);
    const rect = anchor.getBoundingClientRect();
    balloon.style.left = `${Math.round(rect.left)}px`;
    balloon.style.top = `${Math.round(rect.bottom) + 10}px`;
    const timer = setTimeout(() => balloon.close(), 10000);
    balloon.close = () => {
      clearTimeout(timer);
      balloon.remove();
      anchor.removeEventListener("keydown", balloon.close);
      anchor.removeEventListener("blur", balloon.close);
    };
    anchor.addEventListener("keydown", balloon.close);
    anchor.addEventListener("blur", balloon.close);
    return balloon;
  };

  // Puts text in place of start..end. The browser's own edit keeps the
  // change in the box's undo, so Ctrl+Z works like in XP's edit box. A
  // browser without it changes the text directly.
  const replaceText = (input, start, end, text) => {
    input.setSelectionRange(start, end);
    if (document.execCommand?.(text ? "insertText" : "delete", false, text))
      return;
    input.setRangeText(text, start, end);
    input.setSelectionRange(start + text.length, start + text.length);
  };

  // A one-line text box, like XP's edit boxes: each input that takes typed
  // text, a number box too. The paste, Ctrl+A and drop rules use it.
  const isOneLineBox = (target) =>
    target?.tagName === "INPUT" && isEditable(target);

  // The check of each box that refuses some characters, such as a file
  // name box. A paste and typed text go through the same check.
  const textChecks = new WeakMap();

  // Like an XP edit box, a one-line text box keeps only the first line of
  // pasted text. Each browser does a different thing with the line breaks,
  // so the box puts in the first line itself. A box with a check, such as
  // a file name box, puts in only the characters that the check keeps. A
  // box with its own paste, such as the Command Prompt, has
  // data-own-paste.
  document.addEventListener(
    "paste",
    (event) => {
      const input = event.target;
      if (
        !isOneLineBox(input) ||
        input.readOnly ||
        input.disabled ||
        input.dataset.ownPaste !== undefined
      )
        return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const firstLine = text.split(/\r\n|\r|\n/)[0];
      const check = textChecks.get(input);
      const kept = check ? check.keep(firstLine) : firstLine;
      if (kept === text) return;
      event.preventDefault();
      const { selectionStart, selectionEnd } = input;
      // A box without a caret position, such as a number box, takes the
      // text at its own selection.
      if (selectionStart === null) {
        if (kept && !document.execCommand?.("insertText", false, kept))
          input.value = kept;
        return;
      }
      // An empty first line takes the place of the selected text. Text with
      // only refused characters leaves the box as it is.
      if (kept || (!firstLine && selectionStart !== selectionEnd))
        replaceText(input, selectionStart, selectionEnd, kept);
      if (kept !== firstLine) check.refuse();
    },
    true,
  );

  // XP's one-line edit boxes do not select all on Ctrl+A. Multi-line boxes,
  // such as Notepad's, keep it.
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        shortcutKeyOf(event) === "a" &&
        isOneLineBox(event.target)
      )
        event.preventDefault();
    },
    true,
  );

  // XP's edit boxes, one-line and multi-line, take no dropped text. A
  // dropped file is left to the page. An element with data-text-drop, such
  // as the Run dialog, takes the text itself.
  const refusesTextDrop = (event) =>
    !!event.dataTransfer &&
    isEditable(event.target) &&
    !event.target.closest("[data-text-drop]") &&
    !event.dataTransfer.types.includes("Files");
  ["dragenter", "dragover", "drop"].forEach((type) =>
    document.addEventListener(
      type,
      (event) => {
        if (!refusesTextDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      },
      true,
    ),
  );
  // An Explorer drag carries the ids of its items as JSON in this type.
  const ITEM_DRAG_TYPE = "application/x-astro-vfs-ids";
  // True when a drag carries one of the types.
  const takesItemDrag = (event, types) =>
    types.some((type) => event.dataTransfer?.types?.includes(type));
  // The item ids of a drop. A bad list gives no ids.
  const droppedItemIds = (event) => {
    try {
      const ids = JSON.parse(event.dataTransfer.getData(ITEM_DRAG_TYPE));
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };
  // A file from the computer that no folder or window takes is refused,
  // like XP. The browser does not open it in place of the desktop. This
  // listener comes after the targets, so it sees what they did.
  ["dragenter", "dragover", "drop"].forEach((type) =>
    document.addEventListener(type, (event) => {
      if (
        event.defaultPrevented ||
        !event.dataTransfer?.types?.includes("Files")
      )
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
    }),
  );

  // A file name box takes no character that Windows refuses in a name.
  // Like XP's rename box, it drops the character and shows a balloon. Typed
  // and pasted text never gets in. Text from an input method gets in while
  // it is composed, and the box removes the bad characters when the
  // composition ends. Undo and Redo skip each state with a bad character,
  // so they never bring one back.
  const guardFileName = (input) => {
    const invalid = new RegExp(fs().INVALID_NAME_CHARACTERS.source, "g");
    const hasInvalid = (text) => new RegExp(invalid.source).test(text);
    const warn = () =>
      showBalloon(input, [
        "A file name cannot contain any of the following characters:",
        '\\ / : * ? " < > |',
      ]);
    textChecks.set(input, {
      keep: (text) => text.replace(invalid, ""),
      refuse: warn,
    });
    input.addEventListener("beforeinput", (event) => {
      if (event.isComposing || !hasInvalid(event.data || "")) return;
      event.preventDefault();
      const kept = event.data.replace(invalid, "");
      if (kept)
        replaceText(input, input.selectionStart, input.selectionEnd, kept);
      warn();
    });
    const clean = () => {
      const { value, selectionStart } = input;
      const bad = [...value.matchAll(invalid)];
      const start = bad[0].index;
      const end = bad.at(-1).index + 1;
      const caret = value.slice(0, selectionStart).replace(invalid, "").length;
      replaceText(
        input,
        start,
        end,
        value.slice(start, end).replace(invalid, ""),
      );
      input.setSelectionRange(caret, caret);
    };
    input.addEventListener("compositionend", () => {
      if (!hasInvalid(input.value)) return;
      clean();
      warn();
    });
    input.addEventListener("input", (event) => {
      const step = { historyUndo: "undo", historyRedo: "redo" }[
        event.inputType
      ];
      if (!step || !hasInvalid(input.value)) return;
      // The state came from an input method before its bad characters
      // went away. The next step in the same direction is the state
      // before or after it. With no such step, the characters go away
      // here.
      const before = input.value;
      document.execCommand?.(step);
      if (input.value === before) clean();
    });
  };

  // Builds a modal dialog with XP window chrome. Options:
  //   title    - title bar text
  //   wide     - use the wider dialog variant (file dialogs)
  //   modal    - block other UI and trap focus (default: true)
  //   onCancel - Escape/title-close behavior (default: close with null)
  //   help     - add the title bar ? button for "What's This?" help
  //   systemMenu - false for dialogs without a close button (default: true)
  //   closable - false for a gray close button, like XP's Yes/No message
  //              box: the close button, Esc and Alt+F4 do nothing
  //              (default: true)
  // Returns { el, body, close, onResult }.
  // XP's "What's This?" help: the title bar ? button arms help mode, and the
  // next click on a control shows its help text. Controls without help get
  // XP's own "No Help topic" message.
  const NO_HELP_TOPIC = "No Help topic is associated with this item.";
  let helpPopup = null;
  const closeHelpPopup = () => {
    helpPopup?.remove();
    helpPopup = null;
  };
  const showHelpPopup = (text, x, y) => {
    closeHelpPopup();
    helpPopup = document.createElement("div");
    helpPopup.className = "xp-help-popup";
    helpPopup.setAttribute("role", "tooltip");
    helpPopup.textContent = text;
    document.body.appendChild(helpPopup);
    const width = window.visualViewport?.width || innerWidth;
    const height = window.visualViewport?.height || innerHeight;
    helpPopup.style.left = `${Math.max(2, Math.min(x, width - helpPopup.offsetWidth - 2))}px`;
    helpPopup.style.top = `${Math.max(2, Math.min(y, height - helpPopup.offsetHeight - 2))}px`;
    const dismiss = () => {
      closeHelpPopup();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", dismiss, true);
      document.addEventListener("keydown", dismiss, true);
    });
  };

  // Adds the title bar ? button. It arms "What's This?" mode: the next click
  // in the area shows that control's data-help text instead of acting.
  const addWhatsThisHelp = (el, area) => {
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "tb-btn help-btn";
    helpBtn.title = "Help";
    helpBtn.setAttribute("aria-label", "Help");
    helpBtn.addEventListener("click", () => {
      el.classList.add("whats-this");
    });
    el.querySelector(".title-buttons").prepend(helpBtn);
    area.addEventListener(
      "click",
      (event) => {
        if (!el.classList.contains("whats-this")) return;
        event.preventDefault();
        event.stopPropagation();
        el.classList.remove("whats-this");
        const helpText = event.target.closest("[data-help]")?.dataset.help;
        showHelpPopup(helpText || NO_HELP_TOPIC, event.clientX, event.clientY);
      },
      true,
    );
  };

  const createDialog = ({
    title = "",
    wide = false,
    modal = true,
    onCancel = null,
    help = false,
    systemMenu = true,
    closable = true,
  } = {}) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement("div");
    overlay.className = "xp-dialog-overlay";
    overlay.classList.toggle("xp-dialog-modeless", !modal);

    const el = document.createElement("div");
    el.className = `xp-window active xp-dialog${wide ? " xp-dialog-wide" : ""}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", String(modal));
    el.setAttribute("aria-label", title);

    const titleBar = document.createElement("div");
    titleBar.className = "title-bar";
    const titleText = document.createElement("span");
    titleText.className = "title-text";
    titleText.textContent = title;
    const titleButtons = document.createElement("div");
    titleButtons.className = "title-buttons";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tb-btn close-btn";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.disabled = !closable;
    closeBtn.addEventListener("click", () => dialog.cancel());
    if (systemMenu) titleButtons.appendChild(closeBtn);
    titleBar.append(titleText, titleButtons);

    const body = document.createElement("div");
    body.className = "dlg-body";

    el.append(titleBar, body);
    overlay.appendChild(el);
    if (help) addWhatsThisHelp(el, body);
    el.addEventListener("focusin", (event) => {
      dialog.lastFocused = event.target;
    });

    let resultCallback = null;

    // The keys go back to the control that had them. A control that is
    // gone or hidden, like the item of a closed menu, cannot take them.
    // Then a modal dialog, a dialog under this one, the active window or
    // the desktop gets them, like XP. They never stay on the page.
    const giveKeysBack = () => {
      if (
        previouslyFocused !== document.body &&
        previouslyFocused.isConnected &&
        !previouslyFocused.closest("[hidden]")
      ) {
        previouslyFocused.focus();
        if (document.activeElement === previouslyFocused) return;
      }
      if (takeKeys()) return;
      (
        dialogStack.at(-1)?.defaultButton ||
        document.querySelector(".xp-window.active:not(.xp-dialog)") ||
        document.getElementById("desktop-icons")
      ).focus();
    };

    const dialog = {
      el,
      body,
      modal,
      lastFocused: null,
      defaultButton: null,
      accessKeys: new Map(),
      onResult(callback) {
        resultCallback = callback;
      },
      close(result = null) {
        if (!dialogStack.includes(dialog)) return;
        dialogStack.splice(dialogStack.indexOf(dialog), 1);
        dialogStack.at(-1)?.el.classList.add("active");
        overlay.remove();
        if (!dialogStack.length) {
          document.removeEventListener("keydown", handleGlobalKeydown, true);
        }
        giveKeysBack();
        if (resultCallback) resultCallback(result);
      },
      cancel: onCancel || (() => dialog.close(null)),
      onKeydown(e) {
        // The keys of an input method stay in its text box.
        if (isComposingKey(e)) return;
        // An open drop-down list or menu in the dialog takes keys first.
        if (dialog.popupKeydown?.(e)) return;
        if (
          !modal &&
          (!el.contains(e.target) ||
            (e.ctrlKey && e.key === "Escape") ||
            e.key === "Meta")
        )
          return;
        if (e.key === "Tab") {
          if (modal) trapFocus(e);
          return;
        }
        // A box with its own Enter and Esc, such as a rename box, keeps
        // them.
        if (
          (e.key === "Escape" || e.key === "Enter") &&
          e.target?.dataset?.ownKeys !== undefined
        )
          return;
        if (e.key === "Escape") {
          e.preventDefault();
          // Escape leaves "What's This?" mode before it closes the dialog.
          if (el.classList.contains("whats-this"))
            el.classList.remove("whats-this");
          else if (closable) dialog.cancel();
          return;
        }
        // Alt+F4 closes the dialog like its close button. A dialog with a
        // gray close button stays open.
        if (e.altKey && e.key === "F4") {
          e.preventDefault();
          if (closable && systemMenu) dialog.cancel();
          return;
        }
        if (e.key === "Enter") {
          // Click the focused button, or the default button when
          // focus is elsewhere. preventDefault suppresses the
          // browser's own button activation to avoid double-fire.
          const active = document.activeElement;
          // A drop-down box is a button here, but Enter on it runs the
          // default button, like XP's combo boxes.
          if (
            active &&
            el.contains(active) &&
            active.tagName === "BUTTON" &&
            active.getAttribute("role") !== "combobox"
          ) {
            e.preventDefault();
            active.click();
          } else if (active?.tagName !== "TEXTAREA" && dialog.defaultButton) {
            e.preventDefault();
            dialog.defaultButton.click();
          }
          return;
        }
        handleAccessKey(e);
      },
    };

    const trapFocus = (e) => {
      const items = focusableItems(el);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Alt+key always works; the bare key works outside text fields.
    const handleAccessKey = (e) => {
      const letter = accessKeyOf(e);
      if (e.ctrlKey || e.metaKey || letter.length !== 1) return;
      const inTextField = /^(INPUT|TEXTAREA|SELECT)$/.test(
        document.activeElement?.tagName,
      );
      if (!e.altKey && inTextField) return;
      const button = dialog.accessKeys.get(letter);
      if (button && !button.disabled) {
        e.preventDefault();
        button.click();
      }
    };

    if (!dialogStack.length) {
      document.addEventListener("keydown", handleGlobalKeydown, true);
    }
    // Only the newest dialog is active; the ones behind it draw inactive.
    dialogStack.at(-1)?.el.classList.remove("active");
    dialogStack.push(dialog);
    overlay.style.zIndex = (modal ? BASE_Z_INDEX : 6900) + dialogStack.length;
    document.body.appendChild(overlay);

    // Dialogs start centered. Moving or resizing one pins it at explicit
    // overlay coordinates first, so it does not re-center.
    dialog.pinPosition = () => {
      const overlayRect = overlay.getBoundingClientRect();
      const dialogRect = el.getBoundingClientRect();
      el.style.position = "absolute";
      el.style.left = `${dialogRect.left - overlayRect.left}px`;
      el.style.top = `${dialogRect.top - overlayRect.top}px`;
      return { overlayRect, dialogRect };
    };

    // Follows one drag from its pointerdown until the button is released or
    // the drag is canceled, even outside the window.
    dialog.followPointer = (target, event, move) => {
      try {
        target.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture unsupported */
      }
      event.preventDefault();
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    };

    titleBar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".title-buttons")) return;

      const { overlayRect, dialogRect } = dialog.pinPosition();
      const offsetX = event.clientX - dialogRect.left;
      const offsetY = event.clientY - dialogRect.top;
      dialog.followPointer(titleBar, event, (moveEvent) => {
        const maxLeft = Math.max(0, overlay.clientWidth - el.offsetWidth);
        const maxTop = Math.max(0, overlay.clientHeight - el.offsetHeight);
        const left = Math.min(
          Math.max(moveEvent.clientX - overlayRect.left - offsetX, 0),
          maxLeft,
        );
        const top = Math.min(
          Math.max(moveEvent.clientY - overlayRect.top - offsetY, 0),
          maxTop,
        );
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      });
    });
    return dialog;
  };

  // ---- Shared building blocks ----

  // Writes a label with its access key (&X) underlined.
  const appendAccessLabel = (element, label) => {
    const { text, key } = parseAccessKey(label);
    const amp = label.indexOf("&");
    if (!key || amp === -1) {
      element.append(text);
      return;
    }
    const underlined = document.createElement("span");
    underlined.className = "menu-accesskey";
    underlined.textContent = label[amp + 1];
    element.append(label.slice(0, amp), underlined, label.slice(amp + 2));
  };

  const createDialogButton = ({ id, label, isDefault }, onChoose) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `xp-btn${isDefault ? " default" : ""}`;
    button.dataset.action = id;
    appendAccessLabel(button, label);
    button.addEventListener("click", () => onChoose(id));
    return button;
  };

  // Register a button's access key (&X) so Alt+X / bare X activates it.
  const registerAccessKey = (dialog, button, label) => {
    const { key } = parseAccessKey(label);
    if (key && !dialog.accessKeys.has(key)) {
      dialog.accessKeys.set(key, button);
    }
  };

  const addButtonRow = (dialog, buttons) => {
    const row = document.createElement("div");
    row.className = "dlg-buttons";
    buttons.forEach((definition) => {
      const button = createDialogButton(definition, (id) => dialog.close(id));
      if (definition.isDefault) dialog.defaultButton = button;
      registerAccessKey(dialog, button, definition.label);
      row.appendChild(button);
    });
    dialog.body.appendChild(row);
    (dialog.defaultButton || row.querySelector("button"))?.focus();
  };

  // ---- Message boxes ----

  // XPDialogs.message({
  //   title, text, icon: info|warning|error|question,
  //   buttons: BUTTON_SETS.*, defaultButton: optional id override
  // }) -> Promise resolving with the chosen button id.
  const message = ({
    title = "Message",
    text = "",
    icon = "info",
    buttons = BUTTON_SETS.ok,
    defaultButton = null,
  } = {}) =>
    new Promise((resolve) => {
      const resolvedButtons = buttons.map((definition) => ({
        ...definition,
        isDefault: defaultButton
          ? definition.id === defaultButton
          : definition.isDefault,
      }));
      // Like XP's message box, a box with no Cancel answer, such as Yes and
      // No, has a gray close button, and Esc and Alt+F4 do nothing. A box
      // with one button is an OK box: closing it gives that button.
      const cancel =
        resolvedButtons.find((b) => b.isCancel) ||
        (resolvedButtons.length === 1 ? resolvedButtons[0] : null);
      const dialog = createDialog({
        title,
        closable: !!cancel,
        onCancel: () => dialog.close(cancel.id),
      });
      dialog.onResult(resolve);
      dialog.el.classList.add("xp-message-box");

      const row = document.createElement("div");
      row.className = "dlg-message";
      if (ICONS.includes(icon)) {
        const iconEl = document.createElement("span");
        iconEl.className = `dlg-icon dlg-icon-${icon}`;
        iconEl.setAttribute("aria-hidden", "true");
        row.appendChild(iconEl);
      }
      const textEl = document.createElement("p");
      textEl.className = "dlg-text";
      textEl.textContent = text;
      row.appendChild(textEl);
      dialog.body.appendChild(row);

      addButtonRow(dialog, resolvedButtons);
    });

  const alert = (text, title = "Message", icon = "info") =>
    message({ title, text, icon, buttons: BUTTON_SETS.ok });

  // A Yes/No question. It resolves true for Yes. The buttons are a
  // message box's by default; XP's own dialogs pass yesNoClosable.
  const confirm = (
    text,
    title = "Confirm",
    icon = "question",
    buttons = BUTTON_SETS.yesNo,
  ) =>
    message({ title, text, icon, buttons }).then((result) => result === "yes");

  // Explorer, the Desktop and the file dialogs check a rename the same way.
  // The name that a rename box gives, like XP: spaces and periods at the end
  // go away. An empty name, or a device name such as "con" with no
  // extension, keeps the old name with no message: the result is null.
  const renameBoxName = (value) => {
    const name = value.replace(/[.\s]+$/, "");
    try {
      fs().validateName(name);
    } catch (error) {
      if (
        error.code === "name-required" ||
        (error.code === "name-reserved" && !name.includes("."))
      )
        return null;
    }
    return name;
  };

  // XP's text for a name that a rename box cannot use. A name in use and a
  // device name with an extension, such as "con.txt", get the same text. It
  // names the item without its extension.
  const renameErrorText = (error, node) => {
    const dot = node.type === "file" ? node.name.lastIndexOf(".") : -1;
    const shown = dot > 0 ? node.name.slice(0, dot) : node.name;
    if (error.code === "name-exists" || error.code === "name-reserved")
      return `Cannot rename ${shown}: A file with the name you specified already exists. Specify a different file name.`;
    if (error.code === "name-invalid")
      return 'A file name cannot contain any of the following characters:\n\t\\ / : * ? " < > |';
    return error.message || "The file operation failed.";
  };

  // Like XP, a rename that changes or drops the extension of a file of a
  // type with a program, such as ".txt" or ".mp3", asks first. A folder, a
  // file with no extension and a file of a type with no program, such as
  // ".xyz", never ask. It resolves true to go on.
  const confirmExtensionChange = async (node, name) => {
    const extension = fs().extractExtension(node.name);
    if (
      node.type !== "file" ||
      !isKnownFileType(extension) ||
      fs().extractExtension(name) === extension
    )
      return true;
    const answer = await message({
      title: "Rename",
      text: "If you change a file name extension, the file may become unusable.\n\nAre you sure you want to change it?",
      icon: "warning",
      buttons: BUTTON_SETS.yesNo,
    });
    return answer === "yes";
  };

  const alertRenameError = (error, node) =>
    alert(
      renameErrorText(error, node),
      "Error Renaming File or Folder",
      "error",
    );

  // ---- Progress dialog ----

  // XPDialogs.progress({ title, text, cancellable, onCancel }) ->
  //   { update(fraction, detail?), close() }
  const progress = ({
    title = "Progress",
    text = "",
    cancellable = false,
    onCancel = null,
  } = {}) => {
    const dialog = createDialog({
      title,
      onCancel: () => {
        if (cancellable && onCancel) onCancel();
      },
    });

    const label = document.createElement("p");
    label.className = "dlg-text dlg-progress-text";
    label.textContent = text;

    const bar = document.createElement("div");
    bar.className = "xp-progress";
    bar.setAttribute("role", "progressbar");
    const fill = document.createElement("div");
    fill.className = "xp-progress-fill";
    bar.appendChild(fill);

    dialog.body.append(label, bar);

    if (cancellable) {
      const cancelBtn = createDialogButton(
        { id: "cancel", label: "Cancel" },
        () => {
          cancelBtn.disabled = true;
          if (onCancel) onCancel();
        },
      );
      const row = document.createElement("div");
      row.className = "dlg-buttons";
      row.appendChild(cancelBtn);
      dialog.body.appendChild(row);
    }

    return {
      el: dialog.el,
      update(fraction, detail) {
        const percent = Math.min(Math.max(fraction, 0), 1) * 100;
        fill.style.width = `${percent}%`;
        bar.setAttribute("aria-valuenow", String(Math.round(percent)));
        if (detail !== undefined) label.textContent = detail;
      },
      close: () => dialog.close(),
    };
  };

  // ---- Icon helpers shared by Properties and the file dialogs ----

  const fs = () => getFS();

  // The shell registers Explorer's icon factory so dialogs show the same
  // icons as Explorer.
  let nodeIconFactory = null;
  const setNodeIconFactory = (factory) => {
    nodeIconFactory = factory;
  };

  const createNodeIcon = (node) => {
    const icon = document.createElement("span");
    icon.className = "dlg-node-icon";
    if (node.id === fs().RECYCLE_BIN) {
      const image = document.createElement("img");
      image.src = fs().getChildren(fs().RECYCLE_BIN).length
        ? "assets/xp/icons/RecyclerFull.png"
        : "assets/xp/icons/RecyclerEmpty.png";
      image.alt = "";
      icon.appendChild(image);
      return icon;
    }
    icon.append(...nodeIconFactory(node).childNodes);
    return icon;
  };

  // Folders that show only their own icon in Thumbnails view, like XP.
  const plainThumbnailFolders = () => [
    fs().MY_COMPUTER,
    fs().RECYCLE_BIN,
    fs().DRIVE_C,
    fs().DRIVE_D,
    fs().DRIVE_F,
  ];
  // A folder's thumbnail shows its first 4 pictures by name, like XP.
  const FOLDER_PREVIEW_COUNT = 4;
  const folderPreviewUrls = (folderId) =>
    fs()
      .getChildren(folderId)
      .filter((child) => child.type !== "folder")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => fs().getPictureUrl(child.id))
      .filter(Boolean)
      .slice(0, FOLDER_PREVIEW_COUNT);

  // Thumbnails view shows a picture file as the picture itself, scaled to
  // fit the frame, like XP. A folder with pictures shows up to 4 of them on
  // a large folder. Other items keep `icon`. A picture that fails to load
  // gets a new icon from `createIcon`, and a folder preview drops it.
  const fillThumbnail = (icon, node, createIcon) => {
    if (node.type === "folder") {
      if (plainThumbnailFolders().includes(node.id)) return icon;
      const urls = folderPreviewUrls(node.id);
      if (!urls.length) return icon;
      const folder = document.createElement("span");
      folder.className = "folder-thumbnail";
      const pictures = document.createElement("span");
      pictures.className = "folder-thumbnail-pictures";
      urls.forEach((url) => {
        const cell = document.createElement("span");
        const preview = document.createElement("img");
        preview.alt = "";
        preview.decoding = "async";
        // A folder whose previews all fail shows its plain icon.
        preview.addEventListener(
          "error",
          () => {
            cell.remove();
            if (!pictures.childElementCount) icon.replaceWith(createIcon(node));
          },
          { once: true },
        );
        preview.src = url;
        cell.appendChild(preview);
        pictures.appendChild(cell);
      });
      folder.appendChild(pictures);
      icon.replaceChildren(folder);
      return icon;
    }
    const url = fs().getPictureUrl(node.id);
    if (!url) return icon;
    const preview = document.createElement("img");
    preview.className = "thumbnail-picture";
    preview.alt = "";
    preview.decoding = "async";
    preview.addEventListener(
      "error",
      () => icon.replaceWith(createIcon(node)),
      { once: true },
    );
    preview.src = url;
    icon.replaceChildren(preview);
    return icon;
  };
  const createThumbnail = (node) =>
    fillThumbnail(createNodeIcon(node), node, createNodeIcon);

  const describeNodeType = (node) => {
    if (node.id === fs().DRIVE_C) return "Local Disk";
    if (node.id === fs().DRIVE_D) return "Local Disk";
    if (node.id === fs().DRIVE_F) return "Removable Disk";
    if (node.type === "folder") return "File Folder";
    return describeFileType(node.ext);
  };

  // ---- Properties dialog ----

  // XPDialogs.properties(nodeId) -> Promise resolving when closed.
  const properties = (nodeId) =>
    new Promise((resolve) => {
      const node = fs()?.getNode(nodeId);
      if (!node) {
        resolve(null);
        return;
      }

      const dialog = createDialog({
        title: `${node.name} Properties`,
        onCancel: () => dialog.close("ok"),
      });
      dialog.onResult(resolve);

      const header = document.createElement("div");
      header.className = "dlg-props-header";
      const name = document.createElement("span");
      name.className = "dlg-props-name";
      name.textContent = node.name;
      header.append(createNodeIcon(node), name);

      const table = document.createElement("dl");
      table.className = "dlg-props-table";
      const addRow = (label, value) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        table.append(dt, dd);
      };

      addRow("Type:", describeNodeType(node));
      if (node.parent) {
        const parent = fs().getNode(node.parent);
        addRow("Location:", parent ? fs().getPath(parent.id) : "");
      }
      addRow("Size:", formatBytes(fs().getSize(node.id)));
      if (node.type === "folder") {
        let files = 0;
        let folders = 0;
        const pending = [node.id];
        while (pending.length) {
          fs()
            .getChildren(pending.pop())
            .forEach((child) => {
              if (child.type === "folder") {
                folders += 1;
                pending.push(child.id);
              } else {
                files += 1;
              }
            });
        }
        addRow("Contains:", `${files} files, ${folders} folders`);
      }
      const formatDate = (ts) => new Date(ts).toLocaleString();
      addRow("Created:", formatDate(node.created));
      addRow("Modified:", formatDate(node.modified));

      dialog.body.append(header, table);
      addButtonRow(dialog, BUTTON_SETS.ok);
    });

  // ---- Open / Save As dialogs ----

  const findChildByName = (folderId, name) => {
    const wanted = String(name).trim().toLowerCase();
    if (!wanted) return null;
    return (
      fs()
        .getChildren(folderId)
        .find((child) => child.name.toLowerCase() === wanted) || null
    );
  };

  // Open and Save As, laid out like XP's common file dialog: a Places bar,
  // a "Look in"/"Save in" folder box with Back, Up, New Folder and Views,
  // a file list in five views, the File name and type boxes, and a size
  // grip. filterLabel names the filter in the type list, like XP's
  // "Background Files". onDialog(dialog, { nameInput }) receives the
  // dialog and its File name box before the file list renders. It must not
  // call dialog.onResult, which would replace the callback that settles
  // this promise. onAccept({ folderId, name }) validates the current entry
  // and returns false (or Promise<false>) to keep the dialog open, or any
  // other value (or Promise of one) to close the dialog and resolve with
  // that value. Cancel resolves with null. completeName(name, filter) gives
  // the full name for the typed one and the chosen file type, such as the
  // name with a default extension.
  const describeFilter = (filter) =>
    filter?.length
      ? `${filter.map((ext) => ext.replace(".", "").toUpperCase()).join(", ")} Files (${filter.map((ext) => `*${ext}`).join(";")})`
      : "All Files (*.*)";

  // Shell folders draw their own icons in the Places bar and Look in box.
  const PLACE_ICONS = {
    recent: "assets/xp/icons/RecentDocuments.png",
    desktop: "assets/xp/icons/Desktop.png",
    "my-documents": "assets/xp/icons/MyDocuments.png",
    "my-computer": "assets/xp/icons/MyComputer.png",
    "my-network-places": "assets/xp/icons/MyNetworkPlaces.png",
  };
  const createFolderIcon = (node) => {
    const path = PLACE_ICONS[node.id];
    if (!path) return createNodeIcon(node);
    const icon = document.createElement("span");
    icon.className = "dlg-node-icon";
    const image = document.createElement("img");
    image.src = path;
    image.alt = "";
    icon.appendChild(image);
    return icon;
  };

  // XP's Views menu, in its order.
  const FILE_VIEWS = [
    ["thumbnails", "T&humbnails"],
    ["tiles", "Tile&s"],
    ["icons", "Ico&ns"],
    ["list", "&List"],
    ["details", "&Details"],
  ];
  // Explorer and the file dialogs open My Pictures, and every folder in it,
  // in Thumbnails view, like XP.
  const isPictureFolder = (folderId) => {
    for (
      let node = fs().getNode(folderId);
      node;
      node = fs().getNode(node.parent)
    )
      if (node.id === fs().MY_PICTURES) return true;
    return false;
  };
  const defaultFileView = (folderId) =>
    isPictureFolder(folderId) ? "thumbnails" : "list";

  // File names typed into Open and Save As, newest first, for the File
  // name drop-down. They last for the session.
  const recentFileNames = [];
  const rememberFileName = (name) => {
    if (!name) return;
    const index = recentFileNames.indexOf(name);
    if (index !== -1) recentFileNames.splice(index, 1);
    recentFileNames.unshift(name);
    recentFileNames.length = Math.min(recentFileNames.length, 10);
  };

  // A drop-down list or menu that belongs to a dialog. Only one is open at
  // a time. While it is open it gets the dialog's keys first, and a click
  // outside it and its owner closes it. The owner's own click toggles it.
  // Tab and Alt+key close a list and then work as usual. Tab does nothing in
  // a menu, like XP. Other typed keys stay with it, so they never press a
  // dialog button behind it.
  const attachPopup = (dialog, popup, owner, { onKeydown, onClose }) => {
    dialog.closePopup?.();
    popup.hidden = false;
    const outside = (event) => {
      if (!popup.contains(event.target) && !owner.contains(event.target))
        close();
    };
    const close = () => {
      popup.hidden = true;
      dialog.el.removeEventListener("pointerdown", outside, true);
      dialog.popupKeydown = null;
      dialog.closePopup = null;
      onClose();
    };
    dialog.el.addEventListener("pointerdown", outside, true);
    dialog.popupKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }
      if (onKeydown(event, close)) return true;
      if (event.key === "Tab" && popup.getAttribute("role") === "menu") {
        event.preventDefault();
        return true;
      }
      // AltGr sends Ctrl+Alt, and its characters type as usual.
      if (event.key === "Tab" || (event.altKey && !event.ctrlKey)) {
        close();
        return false;
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey)
        return false;
      // Outside a text box a typed key does nothing, so Space does not
      // click the box under the list.
      if (event.target.tagName !== "INPUT") event.preventDefault();
      return true;
    };
    dialog.closePopup = close;
  };

  // Moves the highlight in an open list with the arrow keys, and chooses
  // the highlighted row with Enter. F4 and Alt+Up or Alt+Down close it.
  // With letterOf, a typed letter goes to the next row with that letter,
  // and chooses it when chooseLetter is set, like a menu's access keys.
  const listKeys =
    (rows, getIndex, setIndex, choose, { letterOf, chooseLetter } = {}) =>
    (event, close) => {
      const all = rows();
      const moves = { ArrowDown: 1, ArrowUp: -1 };
      if (event.key === "F4" || (event.altKey && event.key in moves)) {
        event.preventDefault();
        close();
        return true;
      }
      if (event.key in moves) {
        event.preventDefault();
        setIndex(
          Math.max(0, Math.min(all.length - 1, getIndex() + moves[event.key])),
        );
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const row = all[getIndex()];
        close();
        if (row) choose(row);
        return true;
      }
      // A menu matches its access keys by their place on the keyboard,
      // and a list matches the typed character.
      const letter = chooseLetter
        ? accessKeyOf(event)
        : String(event.key).toLowerCase();
      if (
        !letterOf ||
        letter.length !== 1 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return false;
      const index = all
        .map((row, offset) => (getIndex() + 1 + offset) % all.length)
        .find((rowIndex) => letterOf(all[rowIndex]) === letter);
      if (index === undefined) return false;
      event.preventDefault();
      if (chooseLetter) {
        close();
        choose(all[index]);
      } else setIndex(index);
      return true;
    };

  // Gives each file dialog's lists their own element ids.
  let fileDialogCount = 0;

  const browseFiles = ({
    title,
    startFolder,
    filter,
    filterLabel = null,
    initialName = "",
    acceptLabel,
    folderLabel,
    onAccept,
    onDialog = null,
    completeName = (name) => name,
    allFiles = true,
  }) =>
    new Promise((resolve) => {
      let currentFolderId = startFolder || fs().MY_DOCUMENTS;
      if (!fs().getNode(currentFolderId)) currentFolderId = fs().MY_DOCUMENTS;
      const history = [];
      let activeFilter = filter;
      let chosenView = null;

      const dialog = createDialog({
        title,
        help: true,
        onCancel: () => dialog.close(null),
      });
      dialog.el.classList.add("xp-file-dialog");
      dialog.onResult(resolve);
      const idBase = `dlg-file-${++fileDialogCount}`;

      // A field label with its access key underlined. The key focuses the
      // field, like XP's dialog labels.
      const field = (className, labelText, control, focusTarget = control) => {
        // A label would pass its clicks to a button and open its list.
        const label = document.createElement(
          control.tagName === "BUTTON" ? "div" : "label",
        );
        label.className = className;
        const text = document.createElement("span");
        appendAccessLabel(text, labelText);
        label.append(text, control);
        registerAccessKey(
          dialog,
          { disabled: false, click: () => focusTarget.focus() },
          labelText,
        );
        return label;
      };

      // Choosing a row with the mouse keeps the focus in the box that owns
      // the list, like XP's drop-down lists.
      const keepFocus = (popup) =>
        popup.addEventListener("pointerdown", (event) =>
          event.preventDefault(),
        );
      // Rows get ids so the box can name its highlighted row.
      const highlightRow = (owner, rows, index) =>
        rows.forEach((row, rowIndex) => {
          const selected = rowIndex === index;
          row.classList.toggle("selected", selected);
          row.setAttribute("aria-selected", String(selected));
          if (selected) owner.setAttribute("aria-activedescendant", row.id);
          else if (owner.getAttribute("aria-activedescendant") === row.id)
            owner.removeAttribute("aria-activedescendant");
        });

      // "Look in" / "Save in" is a drop-down of folders with their icons,
      // indented like XP's: Desktop, then My Documents, My Computer and its
      // drives, and My Network Places, with the open folder's path shown
      // under the place that holds it. A <select> cannot draw icons.
      const folderBox = document.createElement("button");
      folderBox.type = "button";
      folderBox.className = "dlg-file-folder";
      folderBox.setAttribute("role", "combobox");
      folderBox.setAttribute("aria-haspopup", "listbox");
      folderBox.setAttribute("aria-expanded", "false");
      folderBox.setAttribute("aria-label", parseAccessKey(folderLabel).text);
      const folderValue = document.createElement("span");
      folderValue.className = "dlg-file-folder-value";
      folderBox.appendChild(folderValue);
      const folderList = document.createElement("div");
      folderList.className = "dlg-file-folder-list";
      folderList.setAttribute("role", "listbox");
      folderList.id = `${idBase}-folders`;
      folderList.hidden = true;
      folderBox.setAttribute("aria-controls", folderList.id);
      keepFocus(folderList);

      const folderEntries = () => {
        const entries = [];
        let placed = false;
        const pathTo = (rootId) => {
          const chain = [];
          for (
            let node = fs().getNode(currentFolderId);
            node && node.id !== rootId;
            node = fs().getNode(node.parent)
          ) {
            chain.unshift(node);
            if (!node.parent) return null;
          }
          return chain;
        };
        const branch = (rootId, depth) => {
          entries.push([fs().getNode(rootId), depth]);
          if (placed) return;
          const chain = rootId === currentFolderId ? [] : pathTo(rootId);
          if (!chain) return;
          placed = true;
          chain.forEach((node, index) =>
            entries.push([node, depth + 1 + index]),
          );
        };
        branch(fs().DESKTOP, 0);
        branch(fs().MY_DOCUMENTS, 1);
        entries.push([fs().getNode(fs().MY_COMPUTER), 1]);
        if (currentFolderId === fs().MY_COMPUTER) placed = true;
        fs()
          .getChildren(fs().MY_COMPUTER)
          .forEach((drive) => branch(drive.id, 2));
        branch(fs().MY_NETWORK_PLACES, 1);
        // A folder outside these places, like the Recycle Bin, is listed
        // by its own path under Desktop.
        if (!placed) {
          const chain = [];
          for (
            let node = fs().getNode(currentFolderId);
            node;
            node = fs().getNode(node.parent)
          )
            chain.unshift(node);
          chain.forEach((node, index) => entries.push([node, 1 + index]));
        }
        return entries;
      };

      let folderIndex = 0;
      const folderRows = () => [...folderList.children];
      const highlightFolder = (index) => {
        folderIndex = index;
        highlightRow(folderBox, folderRows(), index);
      };
      const renderFolders = () => {
        const node = fs().getNode(currentFolderId);
        const name = document.createElement("span");
        name.className = "dlg-file-folder-name";
        name.textContent = node.name;
        folderValue.replaceChildren(createFolderIcon(node), name);
        folderBox.dataset.value = currentFolderId;
        folderList.replaceChildren(
          ...folderEntries().map(([entry, depth], index) => {
            const row = document.createElement("div");
            row.className = "dlg-file-folder-option";
            row.setAttribute("role", "option");
            row.id = `${idBase}-folder-${index}`;
            row.dataset.folderId = entry.id;
            row.style.paddingLeft = `${2 + depth * 10}px`;
            const text = document.createElement("span");
            text.textContent = entry.name;
            row.append(createFolderIcon(entry), text);
            row.addEventListener("pointerenter", () => highlightFolder(index));
            row.addEventListener("click", () => {
              dialog.closePopup();
              navigate(entry.id);
            });
            return row;
          }),
        );
        highlightCurrentFolder();

        places.querySelectorAll(".dlg-file-place").forEach((place) => {
          place.classList.toggle(
            "selected",
            place.dataset.folderId === currentFolderId,
          );
        });
      };
      // The highlight goes back to the open folder when the list closes
      // without a choice, so the arrow keys step from there.
      const highlightCurrentFolder = () =>
        highlightFolder(
          folderRows().findIndex(
            (row) => row.dataset.folderId === currentFolderId,
          ),
        );
      const openFolderList = () => {
        folderBox.setAttribute("aria-expanded", "true");
        attachPopup(dialog, folderList, folderBox, {
          onKeydown: listKeys(
            folderRows,
            () => folderIndex,
            highlightFolder,
            (row) => navigate(row.dataset.folderId),
            { letterOf: (row) => row.textContent[0].toLowerCase() },
          ),
          onClose: () => {
            folderBox.setAttribute("aria-expanded", "false");
            highlightCurrentFolder();
          },
        });
      };
      folderBox.addEventListener("click", () => {
        if (folderList.hidden) openFolderList();
        else dialog.closePopup();
      });
      // With the list closed, the arrow keys step through the folders, and
      // F4, Alt+Down or Alt+Up opens the list, like an XP drop-down list.
      folderBox.addEventListener("keydown", (event) => {
        // While the list is open, or when it just closed, it handled the key.
        if (!folderList.hidden || event.defaultPrevented) return;
        if (
          event.key === "F4" ||
          (event.altKey && /^Arrow(Down|Up)$/.test(event.key))
        ) {
          event.preventDefault();
          openFolderList();
          return;
        }
        const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const row = folderRows()[folderIndex + step];
        if (row) navigate(row.dataset.folderId);
      });

      const toolButton = (action, label, icon, onClick) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dlg-file-tool";
        button.dataset.action = action;
        button.title = label;
        button.setAttribute("aria-label", label);
        const image = document.createElement("img");
        image.src = icon;
        image.alt = "";
        button.appendChild(image);
        button.addEventListener("click", onClick);
        return button;
      };
      const backBtn = toolButton(
        "back",
        "Back",
        "assets/xp/icons/Back.png",
        () => {
          currentFolderId = history.pop();
          renderList();
        },
      );
      const upBtn = toolButton(
        "up",
        "Up One Level",
        "assets/xp/icons/Up.png",
        () => navigate(fs().getNode(currentFolderId).parent),
      );
      const newFolderBtn = toolButton(
        "new-folder",
        "Create New Folder",
        "assets/xp/icons/NewFolder.png",
        async () => {
          // Like XP, the new folder gets a rename box in the list. The
          // File name box keeps its text.
          const folderId = currentFolderId;
          let folder;
          try {
            folder = await fs().createFolder(folderId, "New Folder");
          } catch (error) {
            message({
              title,
              text: error.message,
              icon: "error",
              buttons: BUTTON_SETS.ok,
            });
            return;
          }
          // A dialog that closed or went to another folder shows no box.
          if (!dialogStack.includes(dialog) || currentFolderId !== folderId)
            return;
          renderList();
          renameInList(folder.id);
        },
      );
      // Like XP, a new folder cannot go in My Computer or the Recycle Bin.
      const takesNewFolder = (folderId) =>
        folderId !== fs().MY_COMPUTER && !fs().isInRecycleBin(folderId);

      // The rename box of an item in the list, like XP's. A new folder and
      // F2 open it. Enter or a click elsewhere gives the name. Esc keeps the
      // old name. The rules and the texts are the rename box's in Explorer.
      // Like XP, the File name box keeps its text.
      const renameInList = (nodeId) => {
        const item = list.querySelector(
          `.dlg-file-item[data-node-id="${CSS.escape(nodeId)}"]`,
        );
        // F2 in the box reaches the item too. A second start keeps the
        // open box, like Explorer.
        if (item.querySelector(".dlg-file-rename")) return;
        const node = fs().getNode(nodeId);
        const label = item.querySelector(".dlg-file-item-name");
        const input = document.createElement("input");
        input.className = "dlg-file-rename";
        input.dataset.ownKeys = "";
        input.setAttribute("aria-label", "Name");
        input.value = node.name;
        list
          .querySelectorAll(".selected")
          .forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");
        label.replaceWith(input);
        guardFileName(input);
        input.focus();
        input.select();
        let finished = false;
        // Enter and Esc give the keys back to the item. A click elsewhere
        // keeps them where the user put them.
        const finish = async (commit, refocus) => {
          if (finished) return;
          finished = true;
          const name = commit ? renameBoxName(input.value) : null;
          const changed = name !== null && name !== node.name;
          // Like XP, the box keeps the new name while the question shows. No
          // opens the box again with the old name, all selected.
          if (changed && !(await confirmExtensionChange(node, name))) {
            input.replaceWith(label);
            if (dialogStack.includes(dialog) && item.isConnected)
              renameInList(nodeId);
            return;
          }
          input.replaceWith(label);
          if (refocus) item.focus();
          if (!changed) return;
          try {
            await fs().rename(nodeId, name);
            renderList();
          } catch (error) {
            await alertRenameError(error, node);
            // Like XP, the box opens again with the old name, all selected.
            if (item.isConnected) renameInList(nodeId);
          }
        };
        input.addEventListener("keydown", (event) => {
          if (isComposingKey(event)) return;
          if (event.key !== "Enter" && event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          finish(event.key === "Enter", true);
        });
        input.addEventListener("blur", () => finish(true, false));
        // The box is in a list button. Its clicks stay in the box.
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("dblclick", (event) => event.stopPropagation());
      };

      // Views opens XP's menu of list views; the open one has a bullet.
      const viewsMenu = document.createElement("div");
      viewsMenu.className = "xp-context-menu dlg-file-views-menu";
      viewsMenu.setAttribute("role", "menu");
      viewsMenu.hidden = true;
      let viewIndex = 0;
      const viewRows = () => [...viewsMenu.children];
      const highlightView = (index) => {
        viewIndex = index;
        viewRows()[index].focus();
      };
      FILE_VIEWS.forEach(([view, label], index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitemradio");
        item.dataset.view = view;
        const check = document.createElement("span");
        check.className = "context-check";
        const text = document.createElement("span");
        text.className = "context-label";
        appendAccessLabel(text, label);
        item.dataset.accessKey = parseAccessKey(label).key;
        item.append(check, text);
        item.addEventListener("pointerenter", () => highlightView(index));
        item.addEventListener("click", () => {
          dialog.closePopup();
          chosenView = view;
          renderList();
        });
        viewsMenu.appendChild(item);
      });
      const viewsBtn = toolButton(
        "views",
        "View Menu",
        "assets/xp/explorer/toolbar-views-small.png",
        () => {
          if (!viewsMenu.hidden) {
            dialog.closePopup();
            return;
          }
          const current = list.dataset.view;
          viewRows().forEach((row) => {
            const checked = row.dataset.view === current;
            row.setAttribute("aria-checked", String(checked));
            row.firstChild.textContent = checked ? "•" : "";
          });
          viewsBtn.setAttribute("aria-expanded", "true");
          attachPopup(dialog, viewsMenu, viewsBtn, {
            onKeydown: listKeys(
              viewRows,
              () => viewIndex,
              highlightView,
              (row) => {
                chosenView = row.dataset.view;
                renderList();
              },
              { letterOf: (row) => row.dataset.accessKey, chooseLetter: true },
            ),
            onClose: () => {
              viewsBtn.setAttribute("aria-expanded", "false");
              viewsBtn.focus();
            },
          });
          highlightView(FILE_VIEWS.findIndex(([view]) => view === current));
        },
      );
      viewsBtn.setAttribute("aria-haspopup", "menu");
      viewsBtn.setAttribute("aria-expanded", "false");

      const toolbar = document.createElement("div");
      toolbar.className = "dlg-file-toolbar";
      toolbar.append(
        field("dlg-file-folder-field", folderLabel, folderBox),
        backBtn,
        upBtn,
        newFolderBtn,
        viewsBtn,
      );

      const places = document.createElement("div");
      places.className = "dlg-file-places";
      [
        ["My Recent Documents", fs().RECENT],
        ["Desktop", fs().DESKTOP],
        ["My Documents", fs().MY_DOCUMENTS],
        ["My Computer", fs().MY_COMPUTER],
        ["My Network", fs().MY_NETWORK_PLACES],
      ].forEach(([label, folderId]) => {
        const place = document.createElement("button");
        place.type = "button";
        place.className = "dlg-file-place";
        place.dataset.folderId = folderId;
        const image = document.createElement("img");
        image.src = PLACE_ICONS[folderId];
        image.alt = "";
        const text = document.createElement("span");
        text.textContent = label;
        place.append(image, text);
        place.addEventListener("click", () => navigate(folderId));
        places.appendChild(place);
      });

      const list = document.createElement("div");
      list.className = "dlg-file-list";
      list.setAttribute("role", "listbox");
      // An empty folder's list still takes the keys, like XP, but Tab does
      // not stop on the list itself.
      list.tabIndex = -1;

      // File name is an editable drop-down of the names typed before.
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "xp-input";
      nameInput.value = initialName;
      nameInput.id = "dlg-file-name";
      nameInput.setAttribute("role", "combobox");
      nameInput.setAttribute("aria-autocomplete", "list");
      nameInput.setAttribute("aria-expanded", "false");
      const nameArrow = document.createElement("button");
      nameArrow.type = "button";
      nameArrow.className = "dlg-file-name-arrow";
      nameArrow.tabIndex = -1;
      nameArrow.setAttribute("aria-label", "Recent file names");
      const nameList = document.createElement("div");
      nameList.className = "dlg-file-name-list";
      nameList.setAttribute("role", "listbox");
      nameList.id = `${idBase}-names`;
      nameList.hidden = true;
      nameInput.setAttribute("aria-controls", nameList.id);
      keepFocus(nameList);
      keepFocus(nameArrow);
      let nameIndex = -1;
      const nameRows = () => [...nameList.children];
      const highlightName = (index) => {
        nameIndex = index;
        highlightRow(nameInput, nameRows(), index);
      };
      const openNameList = () => {
        nameList.replaceChildren(
          ...recentFileNames.map((name, index) => {
            const row = document.createElement("div");
            row.className = "dlg-file-name-option";
            row.setAttribute("role", "option");
            row.id = `${idBase}-name-${index}`;
            row.textContent = name;
            row.addEventListener("pointerenter", () => highlightName(index));
            row.addEventListener("click", () => {
              dialog.closePopup();
              nameInput.value = name;
            });
            return row;
          }),
        );
        highlightName(-1);
        nameInput.setAttribute("aria-expanded", "true");
        attachPopup(dialog, nameList, nameArrow, {
          onKeydown: listKeys(
            nameRows,
            () => nameIndex,
            highlightName,
            (row) => {
              nameInput.value = row.textContent;
            },
          ),
          onClose: () => {
            nameInput.setAttribute("aria-expanded", "false");
            nameInput.removeAttribute("aria-activedescendant");
          },
        });
        nameInput.focus();
      };
      nameArrow.addEventListener("click", () => {
        if (nameList.hidden) openNameList();
        else dialog.closePopup();
      });
      // F4, Alt+Down or Down opens the list from the keyboard.
      nameInput.addEventListener("keydown", (event) => {
        if (!nameList.hidden || event.defaultPrevented) return;
        if (event.key === "F4" || event.key === "ArrowDown") {
          event.preventDefault();
          openNameList();
        }
      });
      const nameBox = document.createElement("span");
      nameBox.className = "dlg-file-name-box";
      nameBox.append(nameInput, nameArrow);

      const typeSelect = document.createElement("select");
      typeSelect.className = "dlg-file-type";
      [filter, null]
        .filter((entry, index) => index === 0 || (filter?.length && allFiles))
        .forEach((entry) => {
          const option = document.createElement("option");
          option.textContent =
            entry && filterLabel ? filterLabel : describeFilter(entry);
          option.value = entry ? entry.join(",") : "";
          typeSelect.appendChild(option);
        });
      typeSelect.addEventListener("change", () => {
        activeFilter = typeSelect.value ? typeSelect.value.split(",") : null;
        namePattern = null;
        renderList();
      });

      const fields = document.createElement("div");
      fields.className = "dlg-file-fields";
      fields.append(
        field("dlg-file-name-row", "File &name:", nameBox, nameInput),
        field(
          "dlg-file-type-row",
          acceptLabel === "&Save" ? "Save as &type:" : "Files of &type:",
          typeSelect,
        ),
      );

      // The size grip resizes the dialog; the list and fields grow with it.
      // It never makes the dialog smaller than it opened, nor larger than
      // the screen.
      const grip = document.createElement("div");
      grip.className = "dlg-file-grip";
      let minimumSize = null;
      grip.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const width = dialog.el.offsetWidth;
        const height = dialog.body.offsetHeight;
        minimumSize ??= { width, height };
        const { overlayRect, dialogRect } = dialog.pinPosition();
        const frameHeight = dialog.el.offsetHeight - height;
        const maximumWidth = Math.max(
          minimumSize.width,
          overlayRect.right - dialogRect.left,
        );
        const maximumHeight = Math.max(
          minimumSize.height,
          overlayRect.bottom - dialogRect.top - frameHeight,
        );
        const clamp = (value, minimum, maximum) =>
          Math.min(Math.max(value, minimum), maximum);
        dialog.followPointer(grip, event, (moveEvent) => {
          dialog.el.style.width = `${clamp(width + moveEvent.clientX - event.clientX, minimumSize.width, maximumWidth)}px`;
          dialog.body.style.height = `${clamp(height + moveEvent.clientY - event.clientY, minimumSize.height, maximumHeight)}px`;
        });
      });

      dialog.body.append(
        toolbar,
        places,
        list,
        fields,
        grip,
        folderList,
        viewsMenu,
        nameList,
      );
      onDialog?.(dialog, { nameInput });

      // A name with * or ? in the name box filters the list, like XP. A
      // choice in the type box ends it.
      let namePattern = null;
      const matchesFilter = (node) =>
        node.type === "folder" ||
        (namePattern
          ? namePattern.test(node.name)
          : !activeFilter || activeFilter.includes(node.ext));

      const navigate = (folderId) => {
        if (!folderId || folderId === currentFolderId) return;
        history.push(currentFolderId);
        currentFolderId = folderId;
        renderList();
      };

      // The folder that the typed folders name, from the open folder, like
      // XP: "Sub", "..", "C:". Null when one of them is not a folder.
      // A path starts in the open folder. A drive such as "C:", or a "\"
      // at the start, starts it at the top of the drive. Like Windows, ".."
      // stops at the top of a drive, and goes from My Computer to the
      // Desktop.
      const folderOfPath = (segments) => {
        let id = currentFolderId;
        for (const [index, segment] of segments.entries()) {
          const top = index === 0 && (!segment || /^[a-z]:$/i.test(segment));
          if (!top && (!segment || segment === ".")) continue;
          const node = top
            ? fs().getNode(fs().resolvePath(`${segment || "C:"}\\`))
            : segment === ".."
              ? fs().getNode(id).parent === fs().MY_COMPUTER
                ? fs().getNode(id)
                : fs().getParent(id) || fs().getNode(fs().DESKTOP)
              : findChildByName(id, segment);
          if (node?.type !== "folder") return null;
          id = node.id;
        }
        return id;
      };
      const warn = (text) =>
        message({ title, text, icon: "warning", buttons: BUTTON_SETS.ok });

      const accept = () => {
        // A message box must not open behind a drop-down list.
        dialog.closePopup?.();
        const typed = nameInput.value.trim();
        // An empty name is for onAccept to refuse or take.
        if (!typed) return finish(currentFolderId, "");
        // A path names a file in another folder. A path that ends with a
        // folder part, such as "..", "C:" or "\", opens that folder.
        const segments = typed.replace(/\//g, "\\").split("\\");
        const last = segments.at(-1);
        const opensFolder =
          ["", ".", ".."].includes(last) ||
          (segments.length === 1 && /^[a-z]:$/i.test(last));
        const folderId = folderOfPath(
          opensFolder ? segments : segments.slice(0, -1),
        );
        if (!folderId) {
          warn(`${typed}\nPath does not exist.\nCheck the path and try again.`);
          return;
        }
        // A name with * or ? shows only the files that match it. Like the
        // XP dialog, "?" is exactly one character, and a ".*" at the end
        // also takes a name with no extension, so "*.*" shows all files.
        const pattern = last.replace(/[*?]/g, "");
        if (pattern !== last && !fs().INVALID_NAME_CHARACTERS.test(pattern)) {
          // Like XP, the pattern of a type in the type box, such as "*.*"
          // or "*.TXT", chooses that type instead.
          const typeOption = [...typeSelect.options].find(
            (option) =>
              (option.value
                ? option.value
                    .split(",")
                    .map((ext) => `*${ext}`)
                    .join(";")
                : "*.*") === last.toLowerCase(),
          );
          if (typeOption) {
            typeSelect.value = typeOption.value;
            activeFilter = typeOption.value
              ? typeOption.value.split(",")
              : null;
            namePattern = null;
          } else {
            const anyExtension = last.endsWith(".*");
            const source = (anyExtension ? last.slice(0, -2) : last)
              .replace(/[.+^${}()[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".");
            namePattern = new RegExp(
              `^${source}${anyExtension ? "(\\..*)?" : ""}$`,
              "i",
            );
          }
          nameInput.value = last;
          if (folderId === currentFolderId) renderList();
          else navigate(folderId);
          nameInput.select();
          return;
        }
        const name = completeName(last, activeFilter);
        // Like XP, a folder's name opens that folder instead.
        const folder = opensFolder
          ? fs().getNode(folderId)
          : [last, name]
              .map((candidate) => findChildByName(folderId, candidate))
              .find((node) => node?.type === "folder");
        // The typed text stays in the box, all selected, like XP.
        if (folder) {
          navigate(folder.id);
          nameInput.focus();
          nameInput.select();
          return;
        }
        // The file system's own name rules, so a name that it refuses never
        // closes the dialog.
        try {
          fs().validateName(name);
        } catch (error) {
          warn(
            error.code === "name-reserved"
              ? `${name}\nThis file name is reserved for use by Windows.\nChoose another name and try again.`
              : `${name}\nThe above file name is invalid.`,
          );
          return;
        }
        finish(folderId, name);
      };
      const finish = (folderId, name) =>
        Promise.resolve(onAccept({ folderId, name })).then((result) => {
          if (result === false) return;
          rememberFileName(name);
          dialog.close(result);
        });

      // Details and Tiles also show each item's type, size and date.
      const itemDetails = (node) => {
        const type = describeNodeType(node);
        const size = node.type === "folder" ? "" : formatKilobytes(node.size);
        const date = formatDetailsDate(node.modified);
        return { type, size, date };
      };

      const renderList = () => {
        // The list keeps the keys when it is drawn again, like XP.
        const keys = document.activeElement;
        const listHadKeys = list.contains(keys);
        const folder = fs().getNode(currentFolderId);
        const view = chosenView || defaultFileView(currentFolderId);
        list.dataset.view = view;
        renderFolders();
        upBtn.disabled = !folder.parent;
        backBtn.disabled = !history.length;
        newFolderBtn.disabled = !takesNewFolder(folder.id);
        list.replaceChildren();
        if (view === "details") {
          const header = document.createElement("div");
          header.className = "dlg-file-header";
          ["Name", "Size", "Type", "Date Modified"].forEach((label) => {
            const cell = document.createElement("span");
            cell.textContent = label;
            header.appendChild(cell);
          });
          list.appendChild(header);
        }
        fs()
          .getChildren(folder.id)
          .filter(matchesFilter)
          .sort((a, b) =>
            a.type === b.type
              ? a.name.localeCompare(b.name)
              : a.type === "folder"
                ? -1
                : 1,
          )
          .forEach((child) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "dlg-file-item";
            item.setAttribute("role", "option");
            item.dataset.nodeId = child.id;
            const label = document.createElement("span");
            label.className = "dlg-file-item-name";
            label.textContent = child.name;
            item.append(
              view === "thumbnails"
                ? createThumbnail(child)
                : createNodeIcon(child),
              label,
            );
            if (view === "details" || view === "tiles") {
              const { type, size, date } = itemDetails(child);
              (view === "details" ? [size, type, date] : [type, size]).forEach(
                (value) => {
                  const cell = document.createElement("span");
                  cell.className = "dlg-file-item-detail";
                  cell.textContent = value;
                  item.appendChild(cell);
                },
              );
            }
            item.addEventListener("click", () => {
              list.querySelectorAll(".selected").forEach((el) => {
                el.classList.remove("selected");
              });
              item.classList.add("selected");
              if (child.type === "file") nameInput.value = child.name;
            });
            // Like XP, F2 renames the item. A drive and a system folder
            // keep their names.
            item.addEventListener("keydown", (event) => {
              if (
                event.key !== "F2" ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                child.protected
              )
                return;
              event.preventDefault();
              renameInList(child.id);
            });
            item.addEventListener("dblclick", () => {
              if (child.type === "folder") {
                navigate(child.id);
              } else {
                nameInput.value = child.name;
                accept();
              }
            });
            list.appendChild(item);
          });
        // The same item gets the keys back, else the first one, else the
        // empty list. Back or Up One Level that turns gray with the keys
        // gives them to the list too.
        if (!listHadKeys && !([backBtn, upBtn].includes(keys) && keys.disabled))
          return;
        const items = [...list.querySelectorAll(".dlg-file-item")];
        (
          items.find((item) => item.dataset.nodeId === keys.dataset.nodeId) ||
          items[0] ||
          list
        ).focus();
      };

      // Accept and Cancel sit beside the file name and type fields.
      const row = document.createElement("div");
      row.className = "dlg-buttons dlg-file-buttons";
      const acceptBtn = createDialogButton(
        { id: "accept", label: acceptLabel, isDefault: true },
        accept,
      );
      const cancelBtn = createDialogButton(
        { id: "cancel", label: "Cancel" },
        () => dialog.close(null),
      );
      row.append(acceptBtn, cancelBtn);
      dialog.body.appendChild(row);
      dialog.defaultButton = acceptBtn;
      registerAccessKey(dialog, acceptBtn, acceptLabel);

      renderList();
      nameInput.focus();
      nameInput.select();
    });

  // XPDialogs.openFile({ title, startFolder, filter }) ->
  //   Promise resolving with the chosen node, or null on cancel.
  const openFile = ({
    title = "Open",
    startFolder = null,
    filter = null,
  } = {}) =>
    browseFiles({
      title,
      startFolder,
      filter,
      acceptLabel: "&Open",
      folderLabel: "Look &in:",
      onAccept: ({ folderId, name }) => {
        const node = findChildByName(folderId, name);
        if (node && node.type === "file") return node;
        message({
          title,
          text: `Cannot find the "${name}" file.\nCheck the file name and try again.`,
          icon: "error",
          buttons: BUTTON_SETS.ok,
        });
        return false;
      },
    });

  // XPDialogs.saveFile({ title, startFolder, defaultName, filter }) ->
  //   Promise resolving with { parentId, name, existingId }, or null.
  // defaultExtension is added to a name without an extension before the
  // dialog looks for a file to replace, like XP's default extension.
  // A name keeps an extension of the chosen file type, or any extension
  // with All Files. Other names get the default extension, like XP's. The
  // extension follows the file system's rule, so ".txt" has none.
  const withDefaultExtension = (name, defaultExtension, filter) => {
    const extension = fs().extractExtension(name);
    const kept = filter?.length ? filter.includes(extension) : !!extension;
    return defaultExtension && !kept ? `${name}${defaultExtension}` : name;
  };

  const saveFile = ({
    title = "Save As",
    startFolder = null,
    defaultName = "",
    filter = null,
    defaultExtension = "",
    allFiles = true,
  } = {}) =>
    browseFiles({
      title,
      // A deleted file's folder is in the Recycle Bin, and nothing can be
      // saved there. The dialog then starts in My Documents.
      startFolder:
        startFolder && fs().isInRecycleBin(startFolder) ? null : startFolder,
      filter,
      allFiles,
      initialName: defaultName,
      acceptLabel: "&Save",
      folderLabel: "Save &in:",
      completeName: (name, activeFilter) =>
        withDefaultExtension(name, defaultExtension, activeFilter),
      onAccept: ({ folderId, name }) => {
        if (!name) return false;
        // Like XP, My Computer takes no files. The dialog stays open for
        // another folder. The dialog cannot open the Recycle Bin.
        if (folderId === fs().MY_COMPUTER)
          return message({
            title: "Save As",
            text: "You cannot save in the folder you specified. Please choose another location.",
            icon: "warning",
            buttons: BUTTON_SETS.ok,
          }).then(() => false);
        const existing = findChildByName(folderId, name);
        const result = {
          parentId: folderId,
          name,
          existingId: existing ? existing.id : null,
        };
        if (!existing) return result;
        // Like XP, the question has the dialog's own title.
        return message({
          title,
          text: `${name} already exists.\nDo you want to replace it?`,
          icon: "warning",
          buttons: BUTTON_SETS.yesNo,
          defaultButton: "no",
        }).then((answer) => (answer === "yes" ? result : false));
      },
    });

  return {
    ICONS,
    BUTTON_SETS,
    parseAccessKey,
    accessKeyOf,
    shortcutKeyOf,
    isComposingKey,
    ITEM_DRAG_TYPE,
    takesItemDrag,
    droppedItemIds,
    fillThumbnail,
    describeFileType,
    describeNodeType,
    isKnownFileType,
    formatBytes,
    formatDetailsDate,
    formatKilobytes,
    isPictureFolder,
    createDialog,
    takeKeys,
    showBalloon,
    guardFileName,
    renameBoxName,
    confirmExtensionChange,
    alertRenameError,
    addWhatsThisHelp,
    createDialogButton,
    addButtonRow,
    message,
    alert,
    confirm,
    progress,
    properties,
    setNodeIconFactory,
    browseFiles,
    openFile,
    saveFile,
  };
});
