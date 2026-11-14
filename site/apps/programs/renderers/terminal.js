import { createProgramRoot } from "../ui.js";
import { CommandSession } from "../command-session.js";

export const renderTerminal = (context, program, programId) => {
  const content = createProgramRoot(program);
  const session = new CommandSession(context);
  context.setTitle("C:\\WINDOWS\\system32\\cmd.exe");
  content.innerHTML = `<div class="xp-terminal-screen" role="application" aria-label="Command Prompt"><pre class="xp-terminal-output" aria-live="polite"></pre><label class="xp-terminal-prompt"><span></span><input data-default-focus aria-label="Command" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>`;
  const output = content.querySelector(".xp-terminal-output");
  const screen = content.querySelector(".xp-terminal-screen");
  const prompt = content.querySelector(".xp-terminal-prompt span");
  const input = content.querySelector("input");
  const history = [];
  let historyIndex = 0;

  output.textContent = `${session.banner}\n`;
  const updatePrompt = () => {
    prompt.textContent = session.prompt;
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
  // than the window has, and the last row asks for a key.
  const writePaged = async (text) => {
    const page = visibleRows() - 1;
    let rows = 0;
    for (const line of text.split("\n")) {
      if (rows >= page) {
        output.append("Press any key to continue . . . ");
        prompt.textContent = "";
        screen.scrollTop = screen.scrollHeight;
        input.disabled = false;
        input.focus();
        const stop = await waitForKey();
        input.disabled = true;
        output.append("\n");
        if (stop) return;
        rows = 0;
      }
      const shown = document.createTextNode(line);
      output.append(shown);
      rows += screenRows(shown);
      output.append("\n");
    }
  };

  // Runs a command line, like a press of Enter.
  const run = async (command) => {
    if (command.trim()) history.push(command);
    historyIndex = history.length;
    const enteredPrompt = session.prompt;
    input.disabled = true;
    let result;
    try {
      result = await session.execute(command);
    } catch (error) {
      result = { output: error.message };
    }
    // A key press that is left over at the end goes away, like cmd.exe.
    pendingPress = false;
    if (result.exit) return false;
    // Like cmd.exe, a blank line comes after each command, but not after
    // an empty line, and not before the next question of the command.
    // CLS clears the screen, and the blank line stays at the top.
    const blank = command.trim() && !session.question ? "\n" : "";
    if (result.clear) output.textContent = blank;
    else {
      output.textContent += `${enteredPrompt}${command}\n`;
      input.value = "";
      if (result.paged) await writePaged(result.output);
      else if (result.output) output.textContent += `${result.output}\n`;
      output.textContent += blank;
    }
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
  input.addEventListener("paste", (event) => {
    event.preventDefault();
    typeAhead += event.clipboardData.getData("text/plain");
    if (waitingKey && typeAhead) {
      const go = waitingKey;
      waitingKey = null;
      readOneCharacter();
      go(false);
      return;
    }
    feed();
  });

  input.addEventListener("keydown", async (event) => {
    // The keys of an input method stay with it: its Enter runs nothing.
    if (globalThis.XPDialogs.isComposingKey(event)) return;
    if (waitingKey) {
      if (QUIET_KEYS.has(event.key)) return;
      event.preventDefault();
      const go = waitingKey;
      waitingKey = null;
      pendingPress = TWO_PRESS_KEYS.test(event.key);
      go(event.ctrlKey && event.key.toLowerCase() === "c");
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
  return content;
};
