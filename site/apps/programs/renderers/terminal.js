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

  input.addEventListener("keydown", async (event) => {
    // The keys of an input method stay with it: its Enter runs nothing.
    if (globalThis.XPDialogs.isComposingKey(event)) return;
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
    } finally {
      input.disabled = false;
      input.focus();
    }
    if (result.exit) return;
    // Like cmd.exe, a blank line comes after each command, but not after
    // an empty line, and not before the next question of the command.
    const blank = command.trim() && !session.question ? "\n" : "";
    if (result.clear) output.textContent = "";
    else
      output.textContent += `${enteredPrompt}${command}\n${result.output}${result.output ? "\n" : ""}${blank}`;
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
