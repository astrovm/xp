import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";

const mountNotepad = (context, instance) => {
  const { file, window: win } = instance;
  const { dialogs: XPDialogs, fileOps, fs, setAccessKeyText } = context;
  const el = win.el;
  const content = document.createElement("div");
  content.className = "notepad-content";

  const menuBar = document.createElement("div");
  menuBar.className = "notepad-menu-bar";
  menuBar.setAttribute("role", "menubar");
  const editor = document.createElement("textarea");
  // The text gets the keys when the window becomes active.
  editor.dataset.defaultFocus = "";
  editor.className = "notepad-editor";
  editor.setAttribute("aria-label", "Notepad document");
  editor.spellcheck = false;
  editor.wrap = "off";
  const status = document.createElement("div");
  status.className = "notepad-status";
  status.hidden = true;
  content.append(menuBar, editor, status);
  win.nodeId = null;
  win.dirty = false;
  let savedContent = "";

  const updateTitle = () => {
    const node = win.nodeId && fs.getNode(win.nodeId);
    const documentName = node?.name || "Untitled";
    const title = `${documentName} - Notepad`;
    context.setTitle(title);
  };

  const updateStatus = () => {
    const beforeCaret = editor.value.slice(0, editor.selectionStart);
    const lines = beforeCaret.split("\n");
    status.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
  };

  const loadDocument = (node) => {
    win.nodeId = node?.id || null;
    editor.value = node ? fs.getContent(node.id) || "" : "";
    savedContent = editor.value;
    win.dirty = false;
    updateTitle();
    updateStatus();
    editor.focus();
  };

  const saveAs = async () => {
    const current = win.nodeId && fs.getNode(win.nodeId);
    const result = await XPDialogs.saveFile({
      title: "Save As",
      startFolder: current?.parent || fs.MY_DOCUMENTS,
      // The Recycle Bin can rename a deleted file. Save As suggests the
      // name the user gave it.
      defaultName: current?.originalName || current?.name || "Untitled.txt",
      filter: [".txt"],
      defaultExtension: ".txt",
    });
    if (!result) return false;
    const { name } = result;
    const contentToSave = editor.value;
    try {
      // Save As never names a folder: its name opens the folder instead.
      let target = result.existingId && fs.getNode(result.existingId);
      if (!target) {
        target = await fileOps.createFile(result.parentId, name, {
          content: contentToSave,
        });
      } else {
        await fs.setContent(target.id, contentToSave, { name });
      }
      win.nodeId = target.id;
      savedContent = contentToSave;
      win.dirty = editor.value !== savedContent;
      updateTitle();
      return !win.dirty;
    } catch (error) {
      XPDialogs.alert(
        error.message || "The file could not be saved.",
        "Notepad",
        "error",
      );
      return false;
    }
  };

  const save = async () => {
    const node = win.nodeId && fs.getNode(win.nodeId);
    // A deleted file is in the Recycle Bin: Save asks where to save it.
    if (!node || fs.isInRecycleBin(node.id)) return saveAs();
    const contentToSave = editor.value;
    try {
      await fs.setContent(node.id, contentToSave, {
        expectedContent: savedContent,
      });
      savedContent = contentToSave;
      win.dirty = editor.value !== savedContent;
      updateTitle();
      return !win.dirty;
    } catch (error) {
      await XPDialogs.alert(
        error.message || "The file could not be saved.",
        "Notepad",
        "error",
      );
      return false;
    }
  };

  const confirmSaveChanges = async () => {
    if (!win.dirty) return true;
    const node = win.nodeId && fs.getNode(win.nodeId);
    const answer = await XPDialogs.message({
      title: "Notepad",
      text: `The text in the ${node?.name || "Untitled"} file has changed.\n\nDo you want to save the changes?`,
      icon: "warning",
      buttons: XPDialogs.BUTTON_SETS.yesNoCancel,
      defaultButton: "yes",
    });
    if (answer === "cancel") return false;
    if (answer === "no") return true;
    return save();
  };

  const insertText = (text) => {
    editor.setRangeText(
      text,
      editor.selectionStart,
      editor.selectionEnd,
      "end",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const commands = {
    new: async () => {
      if (await confirmSaveChanges()) loadDocument(null);
    },
    open: async () => {
      if (!(await confirmSaveChanges())) return;
      const chosen = await XPDialogs.openFile({
        title: "Open",
        startFolder: fs.MY_DOCUMENTS,
        filter: [".txt"],
      });
      if (chosen) loadDocument(chosen);
    },
    save,
    "save-as": saveAs,
    exit: () => context.close(),
    undo: () => {
      editor.focus();
      document.execCommand("undo");
    },
    cut: async () => {
      const selected = editor.value.slice(
        editor.selectionStart,
        editor.selectionEnd,
      );
      if (selected) {
        await navigator.clipboard?.writeText(selected);
        insertText("");
      }
    },
    copy: () =>
      navigator.clipboard?.writeText(
        editor.value.slice(editor.selectionStart, editor.selectionEnd),
      ),
    paste: async () => {
      const text = await navigator.clipboard?.readText();
      if (typeof text === "string") insertText(text);
    },
    delete: () => insertText(""),
    "select-all": () => {
      editor.focus();
      editor.select();
      updateStatus();
    },
    "time-date": () => insertText(new Date().toLocaleString()),
    "word-wrap": (item) => {
      const enabled = editor.wrap === "off";
      editor.wrap = enabled ? "soft" : "off";
      editor.classList.toggle("word-wrap", enabled);
      item.classList.toggle("checked", enabled);
      item.setAttribute("aria-checked", String(enabled));
    },
    "status-bar": (item) => {
      status.hidden = !status.hidden;
      item.classList.toggle("checked", !status.hidden);
      item.setAttribute("aria-checked", String(!status.hidden));
    },
    about: () =>
      XPDialogs.alert("Microsoft Windows XP\nNotepad", "About Notepad", "info"),
  };

  const menuDefinitions = [
    [
      "&File",
      [
        ["&New", "new", "Ctrl+N"],
        ["&Open...", "open", "Ctrl+O"],
        ["&Save", "save", "Ctrl+S"],
        ["Save &As...", "save-as", ""],
        ["-", "", ""],
        ["E&xit", "exit", ""],
      ],
    ],
    [
      "&Edit",
      [
        ["&Undo", "undo", "Ctrl+Z"],
        ["-", "", ""],
        ["Cu&t", "cut", "Ctrl+X"],
        ["&Copy", "copy", "Ctrl+C"],
        ["&Paste", "paste", "Ctrl+V"],
        ["De&lete", "delete", "Del"],
        ["-", "", ""],
        ["Select &All", "select-all", "Ctrl+A"],
        ["Time/&Date", "time-date", "F5"],
      ],
    ],
    ["F&ormat", [["&Word Wrap", "word-wrap", "", false]]],
    ["&View", [["&Status Bar", "status-bar", "", false]]],
    ["&Help", [["&About Notepad", "about", ""]]],
  ];

  const menus = wireMenuBar({
    windowElement: el,
    bar: menuBar,
    showMenu: (button) => {
      const menu = button.nextElementSibling;
      menu.hidden = false;
      return menu;
    },
  });

  menuDefinitions.forEach(([label, items]) => {
    const group = document.createElement("div");
    group.className = "notepad-menu-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notepad-menu-button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    setAccessKeyText(button, label);
    const menu = document.createElement("div");
    menu.className = "notepad-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    items.forEach(([itemLabel, command, shortcut, checked]) => {
      if (itemLabel === "-") {
        const separator = document.createElement("div");
        separator.className = "notepad-menu-separator";
        menu.appendChild(separator);
        return;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "notepad-menu-item";
      item.dataset.command = command;
      const checkable = typeof checked === "boolean";
      item.setAttribute("role", checkable ? "menuitemcheckbox" : "menuitem");
      if (checkable) {
        item.classList.toggle("checked", checked);
        item.setAttribute("aria-checked", String(checked));
      }
      const check = document.createElement("span");
      check.className = "notepad-menu-check";
      check.textContent = "✓";
      const text = document.createElement("span");
      setAccessKeyText(text, itemLabel);
      const key = document.createElement("span");
      key.className = "notepad-menu-shortcut";
      key.textContent = shortcut;
      item.append(check, text, key);
      item.addEventListener("click", () => {
        menus.close();
        commands[command]?.(item);
      });
      menu.appendChild(item);
    });
    group.append(button, menu);
    menuBar.appendChild(group);
  });

  editor.addEventListener("input", () => {
    win.dirty = true;
    updateStatus();
  });
  ["click", "keyup", "select"].forEach((eventName) =>
    editor.addEventListener(eventName, updateStatus),
  );
  el.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    } else if (event.ctrlKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      commands.open();
    } else if (event.ctrlKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      commands.new();
    } else if (event.key === "F5") {
      event.preventDefault();
      commands["time-date"]();
    }
  });

  loadDocument(file);
  return {
    element: content,
    beforeClose: confirmSaveChanges,
    async openFile(node) {
      if (!(await confirmSaveChanges())) return false;
      loadDocument(node);
      return true;
    },
    unmount() {},
  };
};

export const notepadApplication = defineApplication({
  ...applicationMetadata,
  mount: mountNotepad,
});
