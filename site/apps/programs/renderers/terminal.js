import { createProgramRoot } from "../ui.js";
import { CommandSession, cmdArguments } from "../command-session.js";

// Each Command Prompt window is its own cmd, like XP. options.arguments is
// the text after "cmd": "/k dir" runs dir first, and "/c dir" also closes
// the window when dir ends. Then there is no banner, and the command line
// does not show. options.from is the session of the cmd that opens the
// window with START: the new one starts in its folder. options.title is
// the title that START gives the window.
export const renderTerminal = (context, program, programId, options) => {
  const content = createProgramRoot(program);
  const start = cmdArguments(options.arguments ?? "");
  // The cmd sessions of the window, the last one on top. Like XP, "cmd"
  // typed at the prompt runs a new cmd in the same window, and EXIT goes
  // back to the one before it. close is true for a cmd that ends when its
  // command ends, like "cmd /c dir", or that EXIT ends.
  const shells = [];
  const startShell = (from, close) => {
    const session = new CommandSession(context, { from });
    shells.push({ session, close });
    return session;
  };
  const current = () => shells.at(-1).session;
  startShell(options.from ?? null, start.close);
  context.setTitle(options.title || "C:\\WINDOWS\\system32\\cmd.exe");
  content.innerHTML = `<div class="xp-terminal-screen" role="application" aria-label="Command Prompt"><pre class="xp-terminal-output" aria-live="polite"></pre><label class="xp-terminal-prompt"><span></span><input data-default-focus aria-label="Command" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>`;
  const output = content.querySelector(".xp-terminal-output");
  const screen = content.querySelector(".xp-terminal-screen");
  const prompt = content.querySelector(".xp-terminal-prompt span");
  const input = content.querySelector("input");
  const history = [];
  let historyIndex = 0;

  output.textContent =
    start.command === undefined ? `${current().banner}\n` : "";
  const updatePrompt = () => {
    prompt.textContent = current().prompt;
  };
  updatePrompt();

  // The rows that the screen shows. A screen with no size yet has the 25
  // rows of XP's console window.
  const visibleRows = () =>
    screen.clientHeight > 0
      ? Math.max(2, Math.floor((screen.clientHeight - 4) / 12))
      : 25;
  // The keys that do not go on at "Press any key to continue . . . ", like
  // cmd.exe: the modifier keys, the lock keys, and the keys that give no
  // character of their own.
  const QUIET_KEYS = new Set([
    "Shift",
    "Control",
    "Alt",
    "AltGraph",
    "Meta",
    "OS",
    "Super",
    "Hyper",
    "Fn",
    "FnLock",
    "Symbol",
    "SymbolLock",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "Dead",
    "Process",
    "Unidentified",
  ]);
  // cmd.exe reads an arrow, a page key or a function key as two key
  // presses, so each of these keys goes on two times.
  const TWO_PRESS_KEYS =
    /^(?:Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|F(?:[1-9]|1[0-2]))$/;
  // While output waits after "Press any key to continue . . . ", the next
  // key goes on. Ctrl+C ends the output, like cmd.exe.
  let waitingKey = null;
  // The second press of a two-press key. The next pause uses it.
  let pendingPress = false;
  // Pasted text that cmd.exe has not read yet. Each pause reads one
  // character of it, and each line break runs the line before it.
  let typeAhead = "";
  const LINE_BREAK = /\r\n|\r|\n/;
  // A pause reads one character of the pasted text. A Windows line break
  // is one character.
  const readOneCharacter = () => {
    typeAhead = typeAhead.slice(/^(?:\r\n|[\s\S])/u.exec(typeAhead)[0].length);
  };
  const waitForKey = () => {
    if (pendingPress) {
      pendingPress = false;
      return Promise.resolve(false);
    }
    if (typeAhead) {
      readOneCharacter();
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      waitingKey = resolve;
    });
  };
  // The screen rows that a line of output takes. Like the console, a long
  // line goes on to the next row at the last column.
  const screenRows = (text) => {
    const range = document.createRange();
    range.selectNodeContents(text);
    const tops = new Set(
      [...range.getClientRects()].map((rect) => Math.round(rect.top)),
    );
    return Math.max(1, tops.size);
  };
  // Output that pauses, like DIR /P: each screen shows one screen row less
  // than the window has, and the last row asks for a key. A line goes on
  // the screen while the lines before it take fewer rows than a screen
  // has.
  const writePaged = async (text) => {
    const page = visibleRows() - 1;
    const lines = text.split("\n");
    let next = 0;
    for (;;) {
      // Each line takes one row or more, so a screen holds at most `page`
      // lines. They all go in first, and one layout measures them all.
      const shown = lines
        .slice(next, next + page)
        .map((line) => document.createTextNode(line));
      shown.forEach((line) => output.append(line, "\n"));
      let rows = 0;
      const over = shown.findIndex((line) => {
        if (rows >= page) return true;
        rows += screenRows(line);
        return false;
      });
      if (over >= 0)
        shown.slice(over).forEach((line) => {
          line.nextSibling.remove();
          line.remove();
        });
      next += over >= 0 ? over : shown.length;
      if (next >= lines.length) return;
      output.append("Press any key to continue . . . ");
      prompt.textContent = "";
      screen.scrollTop = screen.scrollHeight;
      input.disabled = false;
      input.focus();
      const stop = await waitForKey();
      input.disabled = true;
      output.append("\n");
      if (stop) return;
    }
  };

  const execute = async (session, command) => {
    try {
      return await session.execute(command);
    } catch (error) {
      return { output: error.message };
    }
  };

  // Runs a command line, like a press of Enter. A command from the command
  // line of cmd does not show, like XP, and does not go in the history.
  // It is false when the window closes.
  const run = async (command, { echo = true } = {}) => {
    if (echo && command.trim()) history.push(command);
    historyIndex = history.length;
    const enteredPrompt = current().prompt;
    input.disabled = true;
    let result = await execute(current(), command);
    // A cmd that the line runs starts on top, and runs its own command.
    // With no command, it shows its banner.
    while (result.shell) {
      const session = startShell(current(), result.shell.close);
      result =
        result.shell.command === undefined
          ? { output: session.banner.trimEnd() }
          : await execute(session, result.shell.command);
    }
    // A key press that is left over at the end goes away, like cmd.exe.
    pendingPress = false;
    if (result.exit) shells.at(-1).close = true;
    // The cmds that end now go away, like XP. With no cmd left, the
    // window closes.
    const leaveShells = () => {
      while (shells.length && shells.at(-1).close && !current().question)
        shells.pop().session.close();
      if (shells.length) return true;
      context.close();
      return false;
    };
    if (result.exit && shells.length === 1) return leaveShells();
    // Like cmd.exe, a blank line comes after each command, but not after
    // an empty line, and not before the next question of the command.
    // CLS clears the screen, and the blank line stays at the top.
    const blank = command.trim() && !current().question ? "\n" : "";
    // New text goes at the end. The text that is on the screen stays as
    // it is, so a long screen is not copied again for each command.
    if (result.clear) output.textContent = blank;
    else {
      if (echo) output.append(`${enteredPrompt}${command}\n`);
      input.value = "";
      if (result.paged) await writePaged(result.output);
      else if (result.output) output.append(`${result.output}\n`);
      output.append(blank);
    }
    if (!leaveShells()) return false;
    input.disabled = false;
    input.focus();
    input.value = "";
    updatePrompt();
    screen.scrollTop = screen.scrollHeight;
    return true;
  };

  // Like a paste in cmd.exe, the pasted text is typed at the caret, and
  // each line break runs the line. Text after the last line break stays
  // typed.
  // The input is off while a line runs, so only one feed runs at a time.
  const feed = async () => {
    while (typeAhead && !input.disabled) {
      const match = LINE_BREAK.exec(typeAhead);
      const typed = match ? typeAhead.slice(0, match.index) : typeAhead;
      typeAhead = match ? typeAhead.slice(match.index + match[0].length) : "";
      input.setRangeText(
        typed,
        input.selectionStart,
        input.selectionEnd,
        "end",
      );
      if (match && !(await run(input.value))) typeAhead = "";
    }
  };
  // The prompt reads the pasted text itself, so the shell's paste rules
  // for one-line boxes do not apply.
  input.dataset.ownPaste = "";
  const typeIn = (text) => {
    typeAhead += text;
    if (waitingKey && typeAhead) {
      const go = waitingKey;
      waitingKey = null;
      readOneCharacter();
      go(false);
      return;
    }
    feed();
  };
  input.addEventListener("paste", (event) => {
    event.preventDefault();
    typeIn(event.clipboardData.getData("text/plain"));
  });

  // Like XP, a dropped item types its path at the caret, in quotes when it
  // has a space. Of many items, only the dragged one goes in, and a drop
  // adds no space. An item in the Recycle Bin and a file from the computer
  // have no path here, so the window does not take them.
  const { ITEM_DRAG_TYPE } = globalThis.XPDialogs;
  const typeItemPath = (ids) => {
    const id = ids[0];
    if (!context.fs.getNode(id) || context.fs.isInRecycleBin(id)) return;
    const path = context.fs.getPath(id);
    input.focus();
    typeIn(path.includes(" ") ? `"${path}"` : path);
  };
  content.dataset.dropAction = "items";
  ["dragenter", "dragover"].forEach((type) =>
    content.addEventListener(type, (event) => {
      if (globalThis.XPDialogs.takesItemDrag(event, [ITEM_DRAG_TYPE]))
        event.preventDefault();
    }),
  );
  content.addEventListener("drop", (event) => {
    if (!globalThis.XPDialogs.takesItemDrag(event, [ITEM_DRAG_TYPE])) return;
    event.preventDefault();
    typeItemPath(globalThis.XPDialogs.droppedItemIds(event));
  });
  // Desktop icons move with the pointer, not with a browser drag.
  content.addEventListener("itemsdrop", (event) =>
    typeItemPath(event.detail.ids),
  );

  input.addEventListener("keydown", async (event) => {
    // The keys of an input method stay with it: its Enter runs nothing.
    if (globalThis.XPDialogs.isComposingKey(event)) return;
    if (waitingKey) {
      if (QUIET_KEYS.has(event.key)) return;
      event.preventDefault();
      const go = waitingKey;
      waitingKey = null;
      pendingPress = TWO_PRESS_KEYS.test(event.key);
      go(event.ctrlKey && globalThis.XPDialogs.shortcutKeyOf(event) === "c");
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (!history.length) return;
      historyIndex = Math.max(
        0,
        Math.min(
          history.length,
          historyIndex + (event.key === "ArrowUp" ? -1 : 1),
        ),
      );
      input.value = history[historyIndex] || "";
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    if (event.key !== "Enter") return;
    if (await run(input.value)) feed();
  });
  screen.addEventListener("pointerdown", () => input.focus());
  context.windowElement.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".title-buttons, .resize-handle")) return;
    setTimeout(() => input.focus(), 0);
  });
  setTimeout(() => input.focus(), 0);
  // The command from cmd's command line. With /c, the window closes when
  // it ends, also after the answer to a question that it asks.
  if (start.command !== undefined) run(start.command, { echo: false });
  // The closed window frees the folders that its sessions are in.
  return {
    element: content,
    unmount: () => shells.forEach(({ session }) => session.close()),
  };
};
