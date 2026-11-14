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
  // While output waits after "Press any key to continue . . . ", the next
  // key goes on. Ctrl+C ends the output, like cmd.exe.
  let waitingKey = null;
  const waitForKey = () =>
    new Promise((resolve) => {
      waitingKey = resolve;
    });
  // Output that pauses, like DIR /P: each screen shows one row less than
  // the window has, and the last row asks for a key.
  const writePaged = async (text) => {
    const lines = text.split("\n");
    const page = visibleRows() - 1;
    for (let start = 0; start < lines.length; start += page) {
      if (start) {
        output.textContent += "Press any key to continue . . . ";
        prompt.textContent = "";
        screen.scrollTop = screen.scrollHeight;
        input.disabled = false;
        input.focus();
        const stop = await waitForKey();
        input.disabled = true;
        output.textContent += "\n";
        if (stop) return;
      }
      output.textContent += `${lines.slice(start, start + page).join("\n")}\n`;
    }
  };

  input.addEventListener("keydown", async (event) => {
    // The keys of an input method stay with it: its Enter runs nothing.
    if (globalThis.XPDialogs.isComposingKey(event)) return;
    if (waitingKey) {
      // Shift, Ctrl and Alt alone do not go on, like cmd.exe.
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      event.preventDefault();
      const go = waitingKey;
      waitingKey = null;
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
    const command = input.value;
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
    if (result.exit) return;
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
  });
  screen.addEventListener("pointerdown", () => input.focus());
  context.windowElement.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".title-buttons, .resize-handle")) return;
    setTimeout(() => input.focus(), 0);
  });
  setTimeout(() => input.focus(), 0);
  return content;
};
